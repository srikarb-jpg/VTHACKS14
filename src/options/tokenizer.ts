/**
 * A deliberately simple tokenizer approximation.
 *
 * This is NOT a real BPE tokenizer and we must not claim it is. It splits on
 * the boundaries a BPE tokenizer tends to split on -- leading spaces stay
 * attached to their word, punctuation separates, long words break up -- which
 * is enough to make the point that text is billed in chunks rather than
 * characters.
 *
 * Shipping tiktoken's vocabulary would be ~1.5MB and a real dependency; the
 * honest framing is "approximate", stated on screen.
 */
const MAX_CHUNK = 6;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // Keep leading whitespace with the following word, as BPE does.
  const pieces = text.match(/\s*[A-Za-z]+|\s*\d+|\s*[^\sA-Za-z\d]|\s+/g) ?? [];
  for (const piece of pieces) {
    if (piece.length <= MAX_CHUNK) {
      tokens.push(piece);
      continue;
    }
    for (let i = 0; i < piece.length; i += MAX_CHUNK) {
      tokens.push(piece.slice(i, i + MAX_CHUNK));
    }
  }
  return tokens;
}

/** Stable pastel per index, so adjacent tokens are always distinguishable. */
export function tokenColor(i: number): string {
  const hue = (i * 47) % 360;
  return `hsl(${hue} 45% 26%)`;
}
