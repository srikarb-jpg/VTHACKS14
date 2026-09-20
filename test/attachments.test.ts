import { describe, it, expect } from 'vitest';
import { File } from 'node:buffer';
import { scrubAttachment, MAX_FILE_BYTES } from '../src/content/attachments';

const file = (text: string, name = 'notes.txt') => new File([text], name) as unknown as globalThis.File;

function pdfFile(text: string): globalThis.File {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return file(pdf, 'ticket.pdf');
}

describe('attachment scrubbing', () => {
  it('redacts contact data and removes original filename metadata', async () => {
    const result = await scrubAttachment(file('Contact alice@example.com twice: alice@example.com', 'alice@example.com.txt'));
    const output = await result.file.text();
    expect(output).not.toContain('alice@example.com');
    expect(result.placeholders).toHaveLength(1);
    expect(output.split(`[${result.placeholders[0]!.token}]`)).toHaveLength(3);
    expect(result.file.name).not.toContain('alice');
  });
  it('uses distinct tokens across files', async () => {
    const a = await scrubAttachment(file('alice@example.com'));
    const b = await scrubAttachment(file('bob@example.com'));
    expect(a.placeholders[0]!.token).not.toBe(b.placeholders[0]!.token);
  });
  it('returns a rebuilt PDF with original dimensions and no recoverable text layer', async () => {
    const result = await scrubAttachment(pdfFile('Contact alice@example.com'));
    expect(result.file.type).toBe('application/pdf');
    expect(result.file.name.endsWith('.pdf')).toBe(true);
    expect(result.placeholders).toHaveLength(1);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(await result.file.arrayBuffer()) });
    try {
      const document = await task.promise;
      const page = await document.getPage(1);
      expect(page.getViewport({ scale: 1 }).width).toBe(612);
      expect(page.getViewport({ scale: 1 }).height).toBe(792);
      expect((await page.getTextContent()).items).toHaveLength(0);
      expect(await page.getAnnotations()).toHaveLength(0);
    } finally { await task.destroy(); }
  }, 20_000);
  it('rejects unsupported formats, binary contents, large files, and classification markings', async () => {
    await expect(scrubAttachment(file('hello', 'report.docx'))).rejects.toThrow('Only text');
    await expect(scrubAttachment(file('hello\0'))).rejects.toThrow('Binary');
    await expect(scrubAttachment(file('a'.repeat(MAX_FILE_BYTES + 1)))).rejects.toThrow('100 KB');
    await expect(scrubAttachment(file('TOP SECRET'))).rejects.toThrow('Classification');
  });
  it('does not release a file when the name detector fails', async () => {
    await expect(scrubAttachment(file('hello'), async () => { throw new Error('unavailable'); })).rejects.toThrow('unavailable');
  });
});
