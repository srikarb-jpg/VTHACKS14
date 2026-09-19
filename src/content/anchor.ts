/**
 * Find where a known piece of text ends inside a page's text, ignoring
 * everything that varies in rendering: whitespace, non-breaking spaces,
 * line breaks, punctuation, letter case.
 *
 * The memory audit anchors on its own prompt to find Claude's reply. An exact
 * substring search silently fails the moment the page renders the prompt with
 * a different space or quote character -- and then the audit waits forever
 * for text it will never find. Comparing only letters and digits removes that
 * whole class of failure.
 *
 * Returns the offset just past the LAST match, in the original text's
 * coordinates, or -1.
 */
export function endOfLast(text: string, needle: string): number {
  const keep = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch);

  const want = [...needle].filter(keep).join('').toLowerCase();
  if (!want) return -1;

  let flat = '';
  const origin: number[] = []; // flat index -> index in `text` (of that char)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (!keep(ch)) continue;
    flat += ch.toLowerCase();
    origin.push(i);
  }

  const at = flat.lastIndexOf(want);
  if (at < 0) return -1;
  const lastChar = origin[at + want.length - 1];
  if (lastChar === undefined) return -1;

  // The needle's own closing punctuation ("...memory.") belongs to it too;
  // leaving it behind would put a stray "." at the start of the reply.
  let end = lastChar + 1;
  const closing = [...needle].reverse().findIndex((ch) => keep(ch) || /\s/.test(ch));
  for (let n = closing < 0 ? 0 : closing; n > 0; n--) {
    const ch = text[end];
    if (ch !== undefined && !keep(ch) && !/\s/.test(ch)) end++;
  }
  return end;
}

/**
 * The region of `after` that was not in `before`, found by trimming the text
 * both share at the start and at the end.
 *
 * A container-independent fallback for when the prompt cannot be located: a
 * new chat starts empty, so whatever appeared between the two snapshots is the
 * conversation we just created.
 */
export function addedSince(before: string, after: string): { start: number; end: number } {
  const max = Math.min(before.length, after.length);
  let p = 0;
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { start: p, end: after.length - s };
}
