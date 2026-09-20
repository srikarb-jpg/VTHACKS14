import { describe, expect, it } from 'vitest';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { collectGlyphRuns, substringBounds } from '../src/content/pdf-glyphs';

const ops = { setFont: 1, showText: 2, save: 3, restore: 4, setCharSpacing: 5, setWordSpacing: 6, setGState: 7, moveText: 8 };
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
    const runs = collectGlyphRuns({ fnArray: [1, 3, 5, 6, 2, 4, 8, 2], argsArray: [['f1', 10], [], [1], [2], [glyphs], [], [0, 0], [glyphs]] }, ops, font);
    expect(substringBounds(item, 1, 2, [runs[1]!])).toEqual({ left: 22, right: 24 });
    const spaced = substringBounds({ ...item, width: 24.5 }, 3, 4, [runs[0]!]);
    expect(spaced).toEqual({ left: 19.5, right: 24.5 });
  });
  it('joins show-text calls that PDF.js merges into one text item', () => {
    const run = (fnArray: number[]) => collectGlyphRuns({ fnArray, argsArray: fnArray.map((op) => op === 1 ? ['f1', 10] : op === 8 ? [0, 0] : [[{ unicode: 'A', width: 500 }, { unicode: 'B', width: 500 }]]) }, ops, font);
    const merged = run([1, 2, 2]);
    expect(merged.map((r) => r.text)).toEqual(['ABAB']);
    // Second call starts where the first ended: B of the second call is 15..20.
    expect(substringBounds({ ...item, str: 'ABAB', width: 20 }, 3, 4, merged)).toEqual({ left: 15, right: 20 });
    // A cursor move starts a new run, so separate lines never join.
    expect(run([1, 2, 8, 2]).map((r) => r.text)).toEqual(['AB', 'AB']);
  });
  it('covers the whole text item when positions are unknown or conflicting', () => {
    expect(substringBounds(item, 1, 2, [])).toEqual({ left: 0, right: 39 });
    const runs = collectGlyphRuns({ fnArray: [1, 2, 2], argsArray: [['f1', 10], [glyphs], [[{ unicode: 'W', width: 100 }, { unicode: 'i', width: 1000 }, { unicode: ' ', width: 250 }, { unicode: 'X', width: 500 }]]] }, ops, font);
    expect(substringBounds(item, 1, 2, runs)).toEqual({ left: 0, right: 39 });
  });
});
