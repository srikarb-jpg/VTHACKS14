import type { Finding, Placeholder } from '../shared/types';
import { buildPdfText } from './pdf-layout';
import { collectGlyphRuns, substringBounds } from './pdf-glyphs';

interface SanitizedText {
  placeholders: Placeholder[];
  findings: Finding[];
}

const MAX_PAGES = 20;
const MAX_TEXT = 100_000;
const MAX_PIXELS = 12_000_000;
const MAX_OUTPUT_BYTES = 20_000_000;

/** Rebuild from redacted pixels only. No original PDF objects, metadata,
 * annotations, links, hidden text or embedded files enter the new document.
 */
export async function scrubPdf(
  bytes: ArrayBuffer,
  sanitize: (text: string) => Promise<SanitizedText>,
): Promise<{ file: File; placeholders: Placeholder[] }> {
  const { getDocument, GlobalWorkerOptions, AnnotationMode, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { PDFDocument } = await import('pdf-lib');
  if (typeof window !== 'undefined') {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    GlobalWorkerOptions.workerSrc = typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL(worker.default.replace(/^\//, ''))
      : worker.default;
  }
  const task = getDocument({ data: new Uint8Array(bytes), stopAtErrors: true, useSystemFonts: true });
  task.onPassword = () => { void task.destroy(); };
  const timeout = setTimeout(() => { void task.destroy(); }, 60_000);
  try {
    const source = await task.promise;
    if (source.numPages > MAX_PAGES) throw new Error('PDFs must have 20 pages or fewer. Upload blocked.');
    const pages = [];
    let text = '';
    const imageOps = new Set(Object.entries(OPS).filter(([key]) => key.startsWith('paintImage') || key.startsWith('paintInlineImage')).map(([, value]) => value));
    for (let n = 1; n <= source.numPages; n++) {
      const page = await source.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      if (!Number.isFinite(viewport.width * viewport.height) || viewport.width * viewport.height > MAX_PIXELS) {
        throw new Error('PDF page dimensions exceed the rendering limit. Upload blocked.');
      }
      const operations = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
      if (operations.fnArray.some((op) => imageOps.has(op))) {
        throw new Error('This PDF contains images that need OCR scanning. Upload blocked.');
      }
      const content = await page.getTextContent();
      const layout = buildPdfText(content.items);
      if (!layout.text.trim()) throw new Error('Every PDF page must contain selectable text. Upload blocked.');
      if (text) text += '\n\n';
      const offset = text.length;
      text += layout.text;
      if (text.length > MAX_TEXT) throw new Error('The PDF contains more than 100,000 extracted characters. Upload blocked.');
      pages.push({ page, viewport, content, operations, spans: layout.spans.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset })) });
    }
    const sanitized = await sanitize(text);
    const output = await PDFDocument.create();
    const factory = source.canvasFactory as {
      create(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
      destroy(target: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }): void;
    };
    let imageBytes = 0;
    for (const { page, viewport, content, operations, spans } of pages) {
      const target = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvas: target.canvas, canvasContext: target.context, viewport, annotationMode: AnnotationMode.DISABLE, background: '#ffffff' }).promise;
        const glyphRuns = collectGlyphRuns(operations, OPS, (name) => page.commonObjs.has(name) ? page.commonObjs.get(name) : undefined);
        const ctx = target.context;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        for (const span of spans) {
          const matches = sanitized.findings.filter((f) => f.start < span.end && f.end > span.start);
          if (!matches.length) continue;
          const item = span.item;
          const [a, b, c, d, x, y] = item.transform as number[];
          const style = content.styles[item.fontName];
          // Conservative coverage requires reliable horizontal text geometry.
          // Page rotation itself is supported by the viewport transform.
          if (item.dir !== 'ltr' || style?.vertical || a === undefined || d === undefined || a <= 0 || d <= 0 || Math.abs(b ?? 0) > 0.01 || Math.abs(c ?? 0) > 0.01 || x === undefined || y === undefined || item.width <= 0) {
            throw new Error('Sensitive text uses an unsupported PDF orientation. Upload blocked.');
          }
          const height = Math.max(Math.abs(d), item.height);
          const ascent = Math.max(1, style?.ascent ?? 1);
          const descent = Math.min(-0.3, style?.descent ?? -0.3);
          for (const match of matches) {
            const bounds = substringBounds(item, Math.max(0, match.start - span.start), Math.min(item.str.length, match.end - span.start), glyphRuns);
            const rect = [
              ...viewport.convertToViewportPoint(x + bounds.left - 0.75, y + descent * height - 1),
              ...viewport.convertToViewportPoint(x + bounds.right + 0.75, y + ascent * height + 1),
            ];
            if (rect.some((value: number) => !Number.isFinite(value))) throw new Error('Invalid PDF text geometry. Upload blocked.');
            const left = Math.min(rect[0]!, rect[2]!);
            const top = Math.min(rect[1]!, rect[3]!);
            const width = Math.abs(rect[2]! - rect[0]!);
            const boxHeight = Math.abs(rect[3]! - rect[1]!);
            // Erase just the detected character range, including glyph kerning.
            ctx.fillStyle = '#292333';
            ctx.fillRect(left, top, width, boxHeight);
          }
        }
        const data = target.canvas.toDataURL('image/png');
        imageBytes += data.length * 0.75;
        if (imageBytes > MAX_OUTPUT_BYTES) throw new Error('The sanitized PDF exceeds 20 MB. Upload blocked.');
        const png = await output.embedPng(data);
        const size = page.getViewport({ scale: 1 });
        const newPage = output.addPage([size.width, size.height]);
        newPage.drawImage(png, { x: 0, y: 0, width: size.width, height: size.height });
      } finally {
        factory.destroy(target);
        page.cleanup();
      }
    }
    const saved = await output.save();
    if (saved.byteLength > MAX_OUTPUT_BYTES) throw new Error('The sanitized PDF exceeds 20 MB. Upload blocked.');
    return {
      file: new File([new Uint8Array(saved)], `scanned-${crypto.randomUUID().slice(0, 8)}.pdf`, { type: 'application/pdf', lastModified: 0 }),
      // Pixel redactions contain no placeholder strings to restore, but keep
      // the counts and local mappings consistent with the attachment API.
      placeholders: sanitized.placeholders.map((p) => ({ ...p, token: `PDF_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}_${p.token}` })),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Upload blocked.')) throw error;
    throw new Error('The PDF could not be processed. It may be encrypted, malformed, or too slow to render. Upload blocked.');
  } finally {
    clearTimeout(timeout);
    await task.destroy();
  }
}
