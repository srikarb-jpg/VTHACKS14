/**
 * Mapping between the plain text we scan and the DOM nodes that render it.
 *
 * This is the piece that makes overlay highlighting possible. A Finding
 * carries character offsets into a string; to draw an underline we need the
 * text node and node-relative offset that string position corresponds to,
 * so we can build a Range and ask the browser where it actually is on screen.
 *
 * CRITICAL: the text we scan must be produced by the SAME walk that builds
 * the segment map. Using `innerText` for scanning and a TreeWalker for
 * positioning does not work -- innerText applies CSS-aware whitespace
 * collapsing, so the two strings drift and every highlight lands a few
 * characters off. Everything reads from buildTextMap().
 */

export interface TextSegment {
  node: Text;
  /** Offset of this node's text within the mapped string. */
  start: number;
  length: number;
}

export interface TextMap {
  text: string;
  segments: TextSegment[];
}

/** Tags that imply a line break in the plain-text rendering. */
const BLOCK = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE',
]);

export function buildTextMap(root: HTMLElement): TextMap {
  const segments: TextSegment[] = [];
  let text = '';

  const newlineIfNeeded = (): void => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
  };

  const walk = (node: Node, isRoot = false): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      // Same-length substitution, so offsets are unaffected. ProseMirror
      // emits non-breaking spaces that would otherwise defeat detectors
      // expecting ordinary whitespace.
      const value = (t.nodeValue ?? '').replace(/\u00a0/g, ' ');
      if (!value) return;
      segments.push({ node: t, start: text.length, length: value.length });
      text += value;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    if (el.tagName === 'BR') {
      text += '\n';
      return;
    }
    // The root is the container we were handed, not a block *within* the
    // text, so it must not contribute its own surrounding newlines.
    const isBlock = !isRoot && BLOCK.has(el.tagName);
    if (isBlock) newlineIfNeeded();
    for (const child of Array.from(node.childNodes)) walk(child);
    if (isBlock) newlineIfNeeded();
  };

  walk(root, true);
  return { text, segments };
}

/** The segment containing `offset`, preferring the one it starts inside. */
function segmentAt(map: TextMap, offset: number): TextSegment | null {
  let best: TextSegment | null = null;
  for (const seg of map.segments) {
    if (seg.start > offset) break;
    if (offset <= seg.start + seg.length) best = seg;
  }
  return best;
}

/**
 * A DOM Range covering [start, end) of the mapped text, or null when the
 * offsets fall in synthesised whitespace (a block boundary) with no node.
 */
export function offsetToRange(map: TextMap, start: number, end: number): Range | null {
  const s = segmentAt(map, start);
  const e = segmentAt(map, end);
  if (!s || !e) return null;
  try {
    const range = document.createRange();
    range.setStart(s.node, Math.min(start - s.start, s.length));
    range.setEnd(e.node, Math.min(end - e.start, e.length));
    return range;
  } catch {
    // Offsets can go stale between a scan and a repaint if the DOM changed
    // underneath us. A missing highlight is fine; a thrown exception in a
    // scroll handler is not.
    return null;
  }
}
