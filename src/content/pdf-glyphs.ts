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
  // PDF.js merges consecutive show-text calls on one line into a single text
  // item, so adjacent calls in the same font extend one run until something
  // repositions the text cursor.
  const moves = new Set([ops.beginText, ops.endText, ops.moveText, ops.setLeadingMoveText, ops.setTextMatrix, ops.nextLine, ops.nextLineShowText, ops.nextLineSetSpacingShowText]);
  let open: Run | undefined;
  let cursor = 0;
  operations.fnArray.forEach((op, i) => {
    const args = operations.argsArray[i]!;
    if (moves.has(op)) { open = undefined; return; }
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
    const run: Run = open?.font === state.font ? open : { font: state.font, text: '', segments: [] };
    let x = run === open ? cursor : 0;
    for (const glyph of args[0] as (Glyph | number)[]) {
      if (typeof glyph === 'number') { x -= glyph * state.size / 1000; continue; }
      const str = glyph.unicode.normalize('NFKC');
      const advance = glyph.width * advanceScale;
      run.segments.push({ start: run.text.length, end: run.text.length + str.length, left: x, right: x + advance });
      run.text += str;
      x += advance + state.charSpace + (glyph.isSpace ? state.wordSpace : 0);
    }
    if (run !== open) runs.push(run);
    open = run;
    cursor = x;
  });
  return runs;
}

/** Non-whitespace characters only, each tagged with the segment it came from. */
function compact(run: Run): { text: string; owner: number[] } {
  let text = '';
  const owner: number[] = [];
  run.segments.forEach((seg, index) => {
    for (const ch of run.text.slice(seg.start, seg.end)) {
      if (/\s/.test(ch)) continue;
      text += ch;
      for (let k = 0; k < ch.length; k++) owner.push(index);
    }
  });
  return { text, owner };
}

/** Bounds in PDF page units, relative to the text item's left edge.
 * PDF.js inserts spaces into item text wherever a gap looks like a word break
 * (LaTeX writes no space glyphs at all), so matching ignores whitespace on
 * both sides and maps back to real glyph segments.
 * Unmatched/ambiguous text falls back to the whole text item rather than a
 * guessed narrower box, so nothing sensitive can be left uncovered.
 */
export function substringBounds(item: TextItem, start: number, end: number, runs: Run[]): { left: number; right: number } {
  if (start <= 0 && end >= item.str.length) return { left: 0, right: item.width };
  const solid = (from: number, to: number) => item.str.slice(from, to).replace(/\s/g, '');
  const needle = solid(0, item.str.length);
  const before = solid(0, Math.max(0, start)).length;
  const upTo = solid(0, Math.max(0, end)).length;
  const matches: { left: number; right: number }[] = [];
  if (needle && upTo > before) {
    for (const run of runs) {
      if (run.font !== item.fontName) continue;
      const { text, owner } = compact(run);
      let at = text.indexOf(needle);
      while (at >= 0) {
        const first = run.segments[owner[at]!];
        const last = run.segments[owner[at + needle.length - 1]!];
        // Do not cut an extracted item through a ligature's character mapping.
        const clean = owner[at - 1] !== owner[at] && owner[at + needle.length] !== owner[at + needle.length - 1];
        if (first && last && clean && last.right > first.left) {
          const chosen = new Set(owner.slice(at + before, at + upTo));
          const selected = run.segments.filter((_, k) => chosen.has(k));
          const scale = item.width / (last.right - first.left);
          const left = (Math.min(...selected.map((s) => s.left)) - first.left) * scale;
          const right = (Math.max(...selected.map((s) => s.right)) - first.left) * scale;
          if (Number.isFinite(left) && Number.isFinite(right) && right > left && left >= -0.5 && right <= item.width + 0.5) matches.push({ left, right });
        }
        at = text.indexOf(needle, at + 1);
      }
    }
  }
  const first = matches[0];
  if (!first || matches.some((m) => Math.abs(m.left - first.left) > 0.5 || Math.abs(m.right - first.right) > 0.5)) {
    // Glyph positions could not be verified. The whole text item always
    // contains the substring, so covering it is wider than needed, never narrower.
    return { left: 0, right: item.width };
  }
  return { left: Math.min(...matches.map((m) => m.left)), right: Math.max(...matches.map((m) => m.right)) };
}
