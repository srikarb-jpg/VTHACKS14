import { describe, expect, it } from 'vitest';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { collectGlyphRuns, substringBounds } from '../src/content/pdf-glyphs';

const ops = { setFont: 1, showText: 2, save: 3, restore: 4, setCharSpacing: 5, setWordSpacing: 6, setGState: 7 };
const font = () => ({ fontMatrix: [0.001, 0, 0, 0.001, 0, 0] });
const item: TextItem = { str: 'Wi X', width: 39, height: 10, transform: [10, 0, 0, 10, 0, 0], fontName: 'f1', dir: 'ltr', hasEOL: false };
const glyphs = [
  { unicode: 'W', width: 1000 }, -100, { unicode: 'i', width: 100 },
  { unicode: ' ', width: 250, isSpace: true }, { unicode: 'X', width: 500 },
];

describe('precise PDF substring bounds', () => {
  it('uses proportional glyph widths, PDF kerning and horizontal scaling', () => {
    const runs = collectGlyphRuns({ fnArray: [1, 2], argsArray: [['f1', 10], [glyphs]] }, ops, font);
    expect(substringBounds(item, 1, 2, runs)).toEqual({ left: 22, right: 24 });
    expect(substringBounds(item, 3, 4, runs)).toEqual({ left: 29, right: 39 });
  });
  it('preserves a complete ligature if part of its text is detected', () => {
    const runs = collectGlyphRuns({ fnArray: [1, 2], argsArray: [['f1', 10], [[{ unicode: 'ﬁ', width: 800 }, { unicode: 'X', width: 500 }]]] }, ops, font);
    expect(substringBounds({ ...item, str: 'fiX', width: 13 }, 1, 2, runs)).toEqual({ left: 0, right: 8 });
  });
  it('accounts for character and word spacing with saved graphics state', () => {
    const runs = collectGlyphRuns({ fnArray: [1, 3, 5, 6, 2, 4, 2], argsArray: [['f1', 10], [], [1], [2], [glyphs], [], [glyphs]] }, ops, font);
    expect(substringBounds(item, 1, 2, [runs[1]!])).toEqual({ left: 22, right: 24 });
    const spaced = substringBounds({ ...item, width: 24.5 }, 3, 4, [runs[0]!]);
    expect(spaced).toEqual({ left: 19.5, right: 24.5 });
  });
  it('rejects unknown or conflicting character positions rather than hiding the row', () => {
    expect(() => substringBounds(item, 1, 2, [])).toThrow('Upload blocked');
    const runs = collectGlyphRuns({ fnArray: [1, 2, 2], argsArray: [['f1', 10], [glyphs], [[{ unicode: 'W', width: 100 }, { unicode: 'i', width: 1000 }, { unicode: ' ', width: 250 }, { unicode: 'X', width: 500 }]]] }, ops, font);
    expect(() => substringBounds(item, 1, 2, runs)).toThrow('Upload blocked');
  });
});
