/**
 * Is something else of the page's own drawn over this box?
 *
 * Our layer sits above everything, so a chip is painted wherever its text
 * happens to be -- including where the text has scrolled underneath the
 * composer or a header, which is how a name ended up floating over the
 * "Write a message" prompt. The clip walk cannot see that, because the
 * composer is not an ancestor of the message; it is just drawn on top of it.
 * Asking the browser what is topmost at the box's centre can.
 *
 * Our own layer is pointer-events:none, so it never answers for the page.
 */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function coveredAt(target: Element, x: number, y: number): boolean {
  const hit = document.elementFromPoint(
    Math.min(Math.max(x, 0), window.innerWidth - 1),
    Math.min(Math.max(y, 0), window.innerHeight - 1),
  );
  return !!hit && !target.contains(hit) && !hit.contains(target);
}

/** The middle of a small box -- enough for a word-sized chip. */
export function coveredByPage(target: Element, rect: Box): boolean {
  if (typeof document.elementFromPoint !== 'function') return false;
  return coveredAt(target, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

/**
 * Is ANY part of a large box covered?
 *
 * The centre is not enough for something as big as a text area: a menu can
 * sit over its left edge and the composer over its bottom while the middle is
 * clear, and a mirror drawn above the whole page then paints straight across
 * both. So sample a grid, edges included, spaced so that anything a person
 * would call a panel -- a menu, the composer -- lands on at least one point.
 */
export function partlyCovered(target: Element, rect: Box): boolean {
  if (typeof document.elementFromPoint !== 'function') return false;
  const cols = Math.min(6, Math.max(2, Math.ceil(rect.width / 160) + 1));
  const rows = Math.min(10, Math.max(2, Math.ceil(rect.height / 48) + 1));
  // Two pixels in from each edge, so a point is never on the border itself.
  const inset = 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = rect.left + inset + ((rect.width - inset * 2) * c) / (cols - 1);
      const y = rect.top + inset + ((rect.height - inset * 2) * r) / (rows - 1);
      if (coveredAt(target, x, y)) return true;
    }
  }
  return false;
}
