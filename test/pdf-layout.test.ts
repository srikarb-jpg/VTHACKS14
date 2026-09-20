import { describe, expect, it } from 'vitest';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { buildPdfText } from '../src/content/pdf-layout';
import { scan } from '../src/worker/detectors';

const item = (str: string, x: number, y: number, width: number, hasEOL = false): TextItem => ({
  str, transform: [12, 0, 0, 12, x, y], width, height: 12, fontName: 'font', dir: 'ltr', hasEOL,
});

describe('PDF layout for detection', () => {
  it('joins split words and email fragments without introducing false spaces', () => {
    const result = buildPdfText([item('Experi', 10, 100, 30), item('ence', 40, 100, 24, true), item('alice@', 10, 80, 36), item('example.com', 46, 80, 66)]);
    expect(result.text).toBe('Experience\nalice@example.com');
    const finding = scan(result.text).findings.find((f) => f.kind === 'email')!;
    expect(finding.value).toBe('alice@example.com');
    expect(result.spans.filter((s) => finding.start < s.end && finding.end > s.start)).toHaveLength(2);
  });
  it('preserves line changes, paragraph gaps, word gaps and column spacing', () => {
    const result = buildPdfText([item('PROFILE', 10, 200, 45), item('Works', 10, 170, 30), item('well', 44, 170, 24), item('2026', 300, 170, 24), item('EDUCATION', 10, 130, 60)]);
    expect(result.text).toBe('PROFILE\n\nWorks well\t2026\n\nEDUCATION');
  });
  it('handles empty PDF line-ending markers without losing span offsets', () => {
    const result = buildPdfText([item('Heading', 10, 100, 42), item('', 52, 100, 0, true), item('Body', 10, 80, 24)]);
    expect(result.text).toBe('Heading\nBody');
    for (const span of result.spans) expect(result.text.slice(span.start, span.end)).toBe(span.item.str);
  });
  it('detects phone numbers using spaced typographic dashes from PDFs', () => {
    const text = 'Contact: (202) 555 – 0147';
    const phone = scan(text).findings.find((f) => f.kind === 'phone');
    expect(phone?.value).toBe('(202) 555 – 0147');
  });
});
