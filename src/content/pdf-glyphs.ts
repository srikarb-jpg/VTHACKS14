import type { TextItem } from 'pdfjs-dist/types/src/display/api';

interface Glyph { unicode: string; width: number; isSpace?: boolean }
interface Font { fontMatrix?: number[]; isType3Font?: boolean; vertical?: boolean }
interface Segment { start: number; end: number; left: number; right: number }
interface Run { font: string; text: string; segments: Segment[] }
interface State { font: string; size: number; charSpace: number; wordSpace: number }

/** Read real glyph advances and TJ kerning from PDF.js's drawing operations.
 * Matching an extracted text item against these runs gives substring bounds
 * without guessing proportional widths or measuring a substitute font.
 */
export function collectGlyphRuns(
  operations: { fnArray: number[]; argsArray: unknown[][] },
  ops: Record<string, number>,
  getFont: (name: string) => Font | undefined,
): Run[] {
  let state: State = { font: '', size: 0, charSpace: 0, wordSpace: 0 };
  const stack: State[] = [];
  const runs: Run[] = [];
  operations.fnArray.forEach((op, i) => {
    const args = operations.argsArray[i]!;
    if (op === ops.save) { stack.push({ ...state }); return; }
    if (op === ops.restore) { state = stack.pop() ?? state; return; }
    if (op === ops.setFont) { state.font = String(args[0]); state.size = Number(args[1]); return; }
    if (op === ops.setCharSpacing) { state.charSpace = Number(args[0]); return; }
    if (op === ops.setWordSpacing) { state.wordSpace = Number(args[0]); return; }
    if (op === ops.setGState) {
      for (const entry of args[0] as [string, unknown][]) {
        if (entry[0] === 'Font') {
          const [name, size] = entry[1] as [string, number];
          state.font = name; state.size = size;
        }
      }
      return;
    }
    if (op !== ops.showText) return;
    const font = getFont(state.font);
    if (!font || font.isType3Font || font.vertical || state.size <= 0) return;
    const advanceScale = state.size * (font.fontMatrix?.[0] ?? 0.001);
    let x = 0;
    const run: Run = { font: state.font, text: '', segments: [] };
    for (const glyph of args[0] as (Glyph | number)[]) {
      if (typeof glyph === 'number') { x -= glyph * state.size / 1000; continue; }
      const str = glyph.unicode.normalize('NFKC');
      const advance = glyph.width * advanceScale;
      run.segments.push({ start: run.text.length, end: run.text.length + str.length, left: x, right: x + advance });
      run.text += str;
      x += advance + state.charSpace + (glyph.isSpace ? state.wordSpace : 0);
    }
    runs.push(run);
  });
  return runs;
}

/** Bounds in PDF page units, relative to the text item's left edge.
 * Unmatched/ambiguous text is rejected instead of silently covering its row
 * or risking an incomplete redaction. Whole items need no glyph matching.
 */
export function substringBounds(item: TextItem, start: number, end: number, runs: Run[]): { left: number; right: number } {
  if (start <= 0 && end >= item.str.length) return { left: 0, right: item.width };
  const matches: { left: number; right: number }[] = [];
  for (const run of runs) {
    if (run.font !== item.fontName) continue;
    let at = run.text.indexOf(item.str);
    while (at >= 0) {
      const segments = run.segments.filter((s) => s.start < at + item.str.length && s.end > at);
      const first = segments[0];
      const last = segments.at(-1);
      // Do not cut an extracted item through a ligature's character mapping.
      if (first?.start === at && last?.end === at + item.str.length && last.right > first.left) {
        const selected = segments.filter((s) => s.start < at + end && s.end > at + start);
        if (selected.length) {
          const scale = item.width / (last.right - first.left);
          const left = (Math.min(...selected.map((s) => s.left)) - first.left) * scale;
          const right = (Math.max(...selected.map((s) => s.right)) - first.left) * scale;
          if (Number.isFinite(left) && Number.isFinite(right) && right > left && left >= -0.5 && right <= item.width + 0.5) matches.push({ left, right });
        }
      }
      at = run.text.indexOf(item.str, at + 1);
    }
  }
  const first = matches[0];
  if (!first || matches.some((m) => Math.abs(m.left - first.left) > 0.5 || Math.abs(m.right - first.right) > 0.5)) {
    throw new Error('Precise PDF character positions could not be verified. Upload blocked.');
  }
  return { left: Math.min(...matches.map((m) => m.left)), right: Math.max(...matches.map((m) => m.right)) };
}
