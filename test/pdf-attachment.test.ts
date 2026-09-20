import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { getDocument, AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { scrubAttachment } from '../src/content/attachments';
import { mkdirSync, writeFileSync } from 'node:fs';

async function fixture(rotation = 0): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  doc.setTitle('alice@example.com confidential original metadata');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([612, 792]);
    page.setRotation(degrees(rotation));
    page.drawText('PROFILE', { x: 72, y: 720, size: 20, font });
    page.drawText('Software engineer with experience building useful tools.', { x: 72, y: 680, size: 12, font });
    page.drawText('Contact:', { x: 72, y: 640, size: 12, font });
    page.drawText('alice@example.com', { x: 150, y: 640, size: 12, font });
    page.drawText('EDUCATION', { x: 72, y: 580, size: 18, font });
    page.drawText('Example University', { x: 72, y: 550, size: 12, font });
  }
  return new Uint8Array(await doc.save());
}

async function render(bytes: Uint8Array<ArrayBuffer>, n = 1) {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await task.promise;
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 2 });
  const factory = doc.canvasFactory as {
    create(w: number, h: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
    destroy(target: unknown): void;
  };
  const target = factory.create(viewport.width, viewport.height);
  await page.render({ canvas: target.canvas, canvasContext: target.context, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
  return { doc, page, viewport, target, async dispose() { factory.destroy(target); await task.destroy(); } };
}

describe('PDF visual redaction', () => {
  it.each([0, 90])('preserves safe pixels and erases sensitive pixels on every page (rotation %i)', async (rotation) => {
    const original = await fixture(rotation);
    const detectNames = vi.fn(async (_text: string) => []);
    const result = await scrubAttachment(new File([original], 'resume.pdf'), detectNames);
    const bytes = new Uint8Array(await result.file.arrayBuffer());
    expect(detectNames.mock.calls[0]![0]).toMatch(/PROFILE\n/);
    const output = await PDFDocument.load(bytes);
    expect(output.getPageCount()).toBe(2);
    expect(output.getTitle()).toBeUndefined();
    expect(result.placeholders).toHaveLength(2);
    for (let n = 1; n <= 2; n++) {
      const before = await render(original, n);
      const after = await render(bytes, n);
      try {
        expect(after.viewport.width).toBe(before.viewport.width);
        expect(after.viewport.height).toBe(before.viewport.height);
        expect((await after.page.getTextContent()).items).toHaveLength(0);
        const rect = (left: number, bottom: number, right: number, top: number) => {
          const a = before.viewport.convertToViewportPoint(left, bottom);
          const b = before.viewport.convertToViewportPoint(right, top);
          return [Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!)] as const;
        };
        const heading = rect(65, 710, 230, 745);
        expect(after.target.context.getImageData(...heading).data).toEqual(before.target.context.getImageData(...heading).data);
        const secret = rect(150, 638, 250, 648);
        const pixels = after.target.context.getImageData(...secret).data;
        for (let i = 0; i < pixels.length; i += 4) {
          expect(Array.from(pixels.slice(i, i + 4))).toEqual([41, 35, 51, 255]);
        }
        if (process.env.PF_PDF_PREVIEW === '1' && rotation === 0 && n === 1) {
          mkdirSync('dev/pdf-preview', { recursive: true });
          writeFileSync('dev/pdf-preview/original.pdf', original);
          writeFileSync('dev/pdf-preview/redacted.pdf', bytes);
          writeFileSync('dev/pdf-preview/original.png', Buffer.from(before.target.canvas.toDataURL('image/png').split(',')[1]!, 'base64'));
          writeFileSync('dev/pdf-preview/redacted.png', Buffer.from(after.target.canvas.toDataURL('image/png').split(',')[1]!, 'base64'));
        }
      } finally { await before.dispose(); await after.dispose(); }
    }
  }, 30_000);

  it('blocks PDFs containing image content instead of copying unscanned pixels', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.drawText('This PDF has an image');
    const png = await doc.embedPng('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII=');
    page.drawImage(png, { x: 30, y: 30, width: 50, height: 50 });
    await expect(scrubAttachment(new File([new Uint8Array(await doc.save())], 'image.pdf'))).rejects.toThrow('OCR');
  });

  it('blocks classification markings and failed name scans in PDFs', async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText('TOP SECRET');
    await expect(scrubAttachment(new File([new Uint8Array(await doc.save())], 'blocked.pdf'))).rejects.toThrow('Classification');
    await expect(scrubAttachment(new File([await fixture()], 'names.pdf'), async () => { throw new Error('NER failed'); })).rejects.toThrow('Upload blocked');
  });

  it('covers resume name, full locality and repeated schools in the actual PDF pixels without NER', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const rows = [
      'Jordan Example', 'Springfield, MO 63005', 'jordan@example.com',
      'PROFILE', 'Motivated student with hands-on experience.', 'EDUCATION',
      'Northern Tech', 'Major: Computer Science', 'Westhaven High School',
      'High School Diploma - General Education', 'SKILLS', 'Programming, teamwork',
      'EXTRACURRICULAR ACTIVITIES', 'Robotics Captain, Westhaven High School, 2025',
    ];
    rows.forEach((line, i) => page.drawText(line, { x: 72, y: 740 - i * 30, size: 12, font }));
    const result = await scrubAttachment(new File([new Uint8Array(await doc.save())], 'resume.pdf'));
    const rendered = await render(new Uint8Array(await result.file.arrayBuffer()));
    try {
      for (const row of [0, 1, 6, 8]) {
        const position = rendered.viewport.convertToViewportPoint(75, 744 - row * 30);
        const pixel = rendered.target.context.getImageData(position[0]!, position[1]!, 1, 1).data;
        expect(Array.from(pixel)).toEqual([41, 35, 51, 255]);
      }
      expect(result.placeholders.some((p) => p.value === 'Jordan Example')).toBe(true);
      expect(result.placeholders.some((p) => p.value === 'Springfield, MO 63005')).toBe(true);
      expect(result.placeholders.some((p) => p.value === 'Northern Tech')).toBe(true);
      expect(result.placeholders.some((p) => /Diploma|Computer Science|Programming/.test(p.value))).toBe(false);
      // The school shares a PDF text run with the activity and date. Only
      // the school may change; both surrounding regions must retain pixels.
      const original = await render(new Uint8Array(await doc.save()));
      try {
        const y = 740 - 13 * 30;
        const schoolX = 72 + font.widthOfTextAtSize('Robotics Captain, ', 12);
        const schoolEnd = schoolX + font.widthOfTextAtSize('Westhaven High School', 12);
        const top = (792 - y - 15) * 2;
        const prefix = [144, top, Math.floor((schoolX - 73) * 2), 42] as const;
        const suffix = [Math.ceil((schoolEnd + 2) * 2), top, 55, 42] as const;
        expect(rendered.target.context.getImageData(...prefix).data).toEqual(original.target.context.getImageData(...prefix).data);
        expect(rendered.target.context.getImageData(...suffix).data).toEqual(original.target.context.getImageData(...suffix).data);
        const school = rendered.target.context.getImageData(Math.ceil(schoolX * 2), Math.floor((792 - y - 6) * 2), Math.floor((schoolEnd - schoolX) * 2), 10).data;
        for (let i = 0; i < school.length; i += 4) expect(Array.from(school.slice(i, i + 4))).toEqual([41, 35, 51, 255]);
      } finally { await original.dispose(); }
    } finally { await rendered.dispose(); }
  }, 20_000);
});
