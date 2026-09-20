import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts, PDFOperator, PDFString, PDFNumber, degrees } from 'pdf-lib';
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

  it('scans the text of a PDF that contains an image and says the image was not read', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.drawText('Mail alice@example.com about this image');
    const png = await doc.embedPng('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII=');
    page.drawImage(png, { x: 30, y: 30, width: 50, height: 50 });
    const result = await scrubAttachment(new File([new Uint8Array(await doc.save())], 'image.pdf'));
    expect(result.unscanned).toBeUndefined();
    expect(result.placeholders.some((p) => p.value === 'alice@example.com')).toBe(true);
    expect(result.notices?.join(' ')).toMatch(/image contents were not/);
  });

  it('attaches a PDF that cannot be processed unchanged, with a notice, instead of blocking', async () => {
    const junk = new File([new Uint8Array([37, 80, 68, 70, 45, 1, 2, 3])], 'broken.pdf');
    const result = await scrubAttachment(junk);
    expect(result.file).toBe(junk);
    expect(result.unscanned).toBe(true);
    expect(result.notices?.[0]).toMatch(/without scanning/);
    const empty = await PDFDocument.create();
    empty.addPage();
    const blank = new File([new Uint8Array(await empty.save())], 'blank.pdf');
    expect((await scrubAttachment(blank)).unscanned).toBe(true);
  });

  it('blocks classification markings in PDFs but not a failed name scan', async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText('TOP SECRET');
    await expect(scrubAttachment(new File([new Uint8Array(await doc.save())], 'blocked.pdf'))).rejects.toThrow('Classification');
    const noNames = await scrubAttachment(new File([await fixture()], 'names.pdf'), async () => { throw new Error('NER failed'); });
    expect(noNames.unscanned).toBeUndefined();
    expect(noNames.notices?.join(' ')).toMatch(/name and organization scan/);
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
  it('redacts a value inside a line written as several show-text calls', async () => {
    // Word, Docs and Chrome print this way; PDF.js reports it as one item.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    const op = (name: string, ...args: (string | number)[]) =>
      PDFOperator.of(name as never, args.map((a) => typeof a === 'string' ? PDFString.of(a) : PDFNumber.of(a)) as never);
    page.pushOperators(
      op('BT'),
      PDFOperator.of('Tf' as never, [page.node.newFontDictionary(font.name, font.ref), PDFNumber.of(12)] as never),
      op('Td', 72, 700),
      op('Tj', 'Contact: '), op('Tj', 'alice@example.com'), op('Tj', ' today'),
      op('ET'),
    );
    const original = new Uint8Array(await doc.save());
    const result = await scrubAttachment(new File([original], 'a.pdf'), async () => []);
    expect(result.file.type).toBe('application/pdf');
    expect(result.placeholders.some((p) => p.value === 'alice@example.com')).toBe(true);
    const before = await render(original);
    const after = await render(new Uint8Array(await result.file.arrayBuffer()));
    try {
      const ink = (t: Awaited<ReturnType<typeof render>>, from: number, to: number) => {
        const data = t.target.context.getImageData(Math.floor(from * 2), Math.floor((792 - 703) * 2), Math.ceil((to - from) * 2), 20).data;
        return Array.from(data).filter((_, i) => i % 4 === 0 && data[i]! < 128).length;
      };
      const start = 72 + font.widthOfTextAtSize('Contact: ', 12);
      const end = start + font.widthOfTextAtSize('alice@example.com', 12);
      // Email region: text becomes a solid redaction block. Words either side keep their pixels.
      expect(ink(after, start + 2, end - 2)).toBeGreaterThan(ink(before, start + 2, end - 2));
      const label = [72, start - 4] as const;
      expect(ink(after, ...label)).toBe(ink(before, ...label));
    } finally { await before.dispose(); await after.dispose(); }
  });
  it('redacts values in a LaTeX-style TJ line that has no space glyphs', async () => {
    // pdfTeX writes words with negative TJ gaps instead of spaces; PDF.js adds the spaces itself.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const page = doc.addPage([612, 792]);
    const words = ['Reach', 'me', 'at', 'alice@example.com', 'or', '555-123-4567'];
    const array = doc.context.obj(words.flatMap((w, i) => i ? [-333, w] : [w]).map((v) => typeof v === 'string' ? PDFString.of(v) : PDFNumber.of(v)));
    page.pushOperators(
      PDFOperator.of('BT' as never),
      PDFOperator.of('Tf' as never, [page.node.newFontDictionary(font.name, font.ref), PDFNumber.of(12)] as never),
      PDFOperator.of('Td' as never, [PDFNumber.of(72), PDFNumber.of(700)] as never),
      PDFOperator.of('TJ' as never, [array] as never),
      PDFOperator.of('ET' as never),
    );
    const original = new Uint8Array(await doc.save());
    const result = await scrubAttachment(new File([original], 'latex.pdf'), async () => []);
    expect(result.placeholders.map((p) => p.value).sort()).toEqual(['555-123-4567', 'alice@example.com']);
    const before = await render(original);
    const after = await render(new Uint8Array(await result.file.arrayBuffer()));
    try {
      const ink = (t: Awaited<ReturnType<typeof render>>, from: number, to: number) => {
        const data = t.target.context.getImageData(Math.floor(from * 2), Math.floor((792 - 703) * 2), Math.ceil((to - from) * 2), 20).data;
        return Array.from(data).filter((_, i) => i % 4 === 0 && data[i]! < 128).length;
      };
      const gap = 0.333 * 12;
      const x = (n: number) => 72 + words.slice(0, n).reduce((sum, w) => sum + font.widthOfTextAtSize(w, 12) + gap, 0);
      // "at" sits between the two redactions and must keep its pixels; the email is blocked out.
      expect(ink(after, x(2) + 1, x(3) - gap - 1)).toBe(ink(before, x(2) + 1, x(3) - gap - 1));
      expect(ink(after, x(3) + 2, x(4) - gap - 2)).toBeGreaterThan(ink(before, x(3) + 2, x(4) - gap - 2));
    } finally { await before.dispose(); await after.dispose(); }
  });
  it('covers rotated sensitive text as a whole item instead of blocking', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([612, 792]).drawText('alice@example.com', { x: 200, y: 300, size: 14, font, rotate: degrees(30) });
    const result = await scrubAttachment(new File([new Uint8Array(await doc.save())], 'tilted.pdf'), async () => []);
    expect(result.unscanned).toBeUndefined();
    expect(result.placeholders.some((p) => p.value === 'alice@example.com')).toBe(true);
    const after = await render(new Uint8Array(await result.file.arrayBuffer()));
    try {
      const px = after.target.context.getImageData(0, 0, after.target.canvas.width, after.target.canvas.height).data;
      let covered = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] === 41 && px[i + 1] === 35 && px[i + 2] === 51) covered++;
      expect(covered).toBeGreaterThan(500);
      // Only the tilted text's box is covered, not the whole page.
      expect(covered).toBeLessThan(px.length / 4 / 4);
    } finally { await after.dispose(); }
  });
});
