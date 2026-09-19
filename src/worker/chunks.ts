/**
 * Content-defined chunking.
 *
 * The cache below only pays off if a chunk's identity survives edits made
 * elsewhere in the text. Splitting by fixed offsets fails that immediately:
 * inserting one character at the top shifts every later boundary and
 * invalidates everything. So we split on CONTENT -- sentence ends and line
 * breaks -- which means an edit inside one sentence dirties that sentence
 * and nothing else.
 *
 * Same idea as rsync's content-defined chunking, at a much coarser grain.
 */

export interface Chunk {
  /** The chunk's own text, without context padding. */
  text: string;
  /** Offset of `text` within the full document. */
  start: number;
}

/**
 * Cap on chunk length. A pasted wall of text with no sentence punctuation
 * would otherwise become one giant chunk, which defeats the cache -- every
 * keystroke would re-scan all of it.
 */
const MAX_CHUNK = 400;

/**
 * Context included on each side when scanning, so a detection straddling a
 * boundary is still found. Must exceed the longest plausible single match
 * that could span a break (an address across two lines, a wrapped key).
 */
export const CONTEXT = 48;

function isSentenceEnd(text: string, i: number): boolean {
  const c = text[i];
  if (c !== '.' && c !== '!' && c !== '?') return false;
  const next = text[i + 1];
  // A period followed by whitespace or end-of-text ends a sentence. One
  // followed by a letter or digit does not -- that is a decimal, a version
  // number, a domain, or a file extension.
  return next === undefined || /\s/.test(next);
}

/** Split points, always including 0 and text.length. */
function boundaries(text: string): number[] {
  const pts = new Set<number>([0, text.length]);

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      pts.add(i + 1);
      continue;
    }
    if (isSentenceEnd(text, i)) {
      // Absorb the whitespace after the sentence into the preceding chunk,
      // so that typing the space does not create a new empty chunk.
      let j = i + 1;
      while (j < text.length && /[ \t]/.test(text[j] ?? '')) j++;
      pts.add(j);
    }
  }

  const sorted = [...pts].sort((a, b) => a - b);

  // Enforce the length cap by inserting extra breaks at whitespace.
  const capped: number[] = [];
  for (let k = 0; k < sorted.length; k++) {
    const from = sorted[k];
    const to = sorted[k + 1];
    if (from === undefined) continue;
    capped.push(from);
    if (to === undefined) continue;
    let cursor = from;
    while (to - cursor > MAX_CHUNK) {
      // Prefer a space near the cap; fall back to a hard cut.
      let cut = cursor + MAX_CHUNK;
      const window = text.slice(cursor + MAX_CHUNK - 60, cursor + MAX_CHUNK);
      const ws = window.lastIndexOf(' ');
      if (ws !== -1) cut = cursor + MAX_CHUNK - 60 + ws + 1;
      capped.push(cut);
      cursor = cut;
    }
  }

  return [...new Set(capped)].sort((a, b) => a - b);
}

export function splitStable(text: string): Chunk[] {
  if (!text) return [];
  const pts = boundaries(text);
  const chunks: Chunk[] = [];
  for (let i = 0; i < pts.length; i++) {
    const start = pts[i];
    const end = pts[i + 1] ?? text.length;
    if (start === undefined || start >= end) continue;
    chunks.push({ text: text.slice(start, end), start });
  }
  return chunks;
}

/**
 * FNV-1a, 32 bit. Not cryptographic and does not need to be -- a collision
 * costs a stale finding on one chunk, and the authoritative submit scan is
 * keyed the same way, so there is no correctness cliff.
 */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
