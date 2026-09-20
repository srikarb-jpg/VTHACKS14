import type { Finding, Placeholder } from '../shared/types';
import { buildPdfText } from './pdf-layout';
import { collectGlyphRuns, substringBounds } from './pdf-glyphs';
import { UploadBlocked } from './upload-blocked';

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
): Promise<{ file: File; placeholders: Placeholder[]; notices: string[] }> {
  const notices: string[] = [];
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
    if (source.numPages > MAX_PAGES) throw new Error('It has more than 20 pages.');
    const pages = [];
    let text = '';
    let imagePages = 0;
    const imageOps = new Set(Object.entries(OPS).filter(([key]) => key.startsWith('paintImage') || key.startsWith('paintInlineImage')).map(([, value]) => value));
    for (let n = 1; n <= source.numPages; n++) {
      const page = await source.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      if (!Number.isFinite(viewport.width * viewport.height) || viewport.width * viewport.height > MAX_PIXELS) {
        throw new Error('A page is too large to render.');
      }
      const operations = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
      // Images stay as pixels in the rebuilt page. Their contents are not read.
      if (operations.fnArray.some((op) => imageOps.has(op))) imagePages++;
      const content = await page.getTextContent();
      const layout = buildPdfText(content.items);
      if (text && layout.text) text += '\n\n';
      const offset = text.length;
      text += layout.text;
      if (text.length > MAX_TEXT) throw new Error('It contains more than 100,000 characters of text.');
      pages.push({ page, viewport, content, operations, spans: layout.spans.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset })) });
    }
    if (!text.trim()) throw new Error('It has no selectable text to scan.');
    if (imagePages) notices.push(`${imagePages} page(s) contain images; text was scanned but image contents were not.`);
    const sanitized = await sanitize(text);
    const output = await PDFDocument.create();
    const factory = source.canvasFactory as {
      create(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
      destroy(target: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }): void;
    };
    let imageBytes = 0;
    const coveredPages = new Set<number>();
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
          // Reliable substring geometry needs upright horizontal text. Anything
          // else is covered as a whole item, never left visible.
          const upright = item.dir === 'ltr' && !style?.vertical && a !== undefined && d !== undefined && a > 0 && d > 0 &&
            Math.abs(b ?? 0) <= 0.01 && Math.abs(c ?? 0) <= 0.01 && x !== undefined && y !== undefined && item.width > 0;
          if (!upright) {
            if (!coverItem(target, viewport, item, style?.vertical, style)) coveredPages.add(page.pageNumber);
            continue;
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
            if (rect.some((value: number) => !Number.isFinite(value))) {
              target.context.fillStyle = '#292333';
              target.context.fillRect(0, 0, target.canvas.width, target.canvas.height);
              coveredPages.add(page.pageNumber);
              continue;
            }
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
        if (imageBytes > MAX_OUTPUT_BYTES) throw new Error('The rebuilt PDF would exceed 20 MB.');
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
    if (saved.byteLength > MAX_OUTPUT_BYTES) throw new Error('The rebuilt PDF would exceed 20 MB.');
    if (coveredPages.size) notices.push(`Page(s) ${[...coveredPages].join(', ')} had text that could not be located, so the whole page was covered.`);
    return {
      notices,
      file: new File([new Uint8Array(saved)], `scanned-${crypto.randomUUID().slice(0, 8)}.pdf`, { type: 'application/pdf', lastModified: 0 }),
      // Pixel redactions contain no placeholder strings to restore, but keep
      // the counts and local mappings consistent with the attachment API.
      placeholders: sanitized.placeholders.map((p) => ({ ...p, token: `PDF_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}_${p.token}` })),
    };
  } catch (error) {
    if (error instanceof UploadBlocked) throw error;
    // Callers treat any other failure as "could not scan", not as a policy stop.
    throw new Error(error instanceof Error && /^(It |A page)/.test(error.message) ? error.message : 'It may be encrypted, malformed, or too slow to render.');
  } finally {
    clearTimeout(timeout);
    await task.destroy();
  }
}

/** Cover a whole text item that is rotated, skewed or vertical. Returns false
 * when even that geometry is unusable and the entire page had to be covered.
 */
function coverItem(
  target: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D },
  viewport: { convertToViewportPoint(x: number, y: number): number[] },
  item: { transform: number[]; width: number },
  vertical: boolean | undefined,
  style: { ascent?: number; descent?: number } | undefined,
): boolean {
  const [a, b, c, d, x, y] = item.transform as [number, number, number, number, number, number];
  const ctx = target.context;
  ctx.fillStyle = '#292333';
  if (vertical || ![a, b, c, d, x, y].every(Number.isFinite) || !(item.width > 0) || !Math.hypot(a, b)) {
    ctx.fillRect(0, 0, target.canvas.width, target.canvas.height);
    return false;
  }
  const len = Math.hypot(a, b);
  const ascent = Math.max(1, style?.ascent ?? 1);
  const descent = Math.min(-0.3, style?.descent ?? -0.3);
  const points = [-1, item.width + 1].flatMap((s) => [descent, ascent].map((e) => viewport.convertToViewportPoint(x + a / len * s + c * e, y + b / len * s + d * e)));
  const xs = points.map((p) => p[0]!);
  const ys = points.map((p) => p[1]!);
  if (![...xs, ...ys].every(Number.isFinite)) { ctx.fillRect(0, 0, target.canvas.width, target.canvas.height); return false; }
  ctx.fillRect(Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) - Math.min(...xs) + 4, Math.max(...ys) - Math.min(...ys) + 4);
  return true;
}
