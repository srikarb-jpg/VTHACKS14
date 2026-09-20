/**
 * Hover rehydration.
 *
 * The spec's full version rewrites the streamed response so placeholders
 * become real values again. We deliberately do not do that: mutating another
 * app's React-managed DOM mid-stream is the single most likely way to break
 * the page during a demo, and the payoff is cosmetic.
 *
 * Instead, placeholders in the response become hoverable. The user sees
 * [PERSON_1] and hovers to reveal "Dana Whitfield". The mapping is real, the
 * reversibility claim is honest, and we never touch the site's own nodes
 * beyond wrapping a text span.
 */
import type { Placeholder } from '../shared/types';
import { PLACEHOLDER_PATTERN } from '../shared/config';
import { getLayer } from './ui/shell';
import type { ComposerAdapter } from './adapters/types';

const MARKED = 'data-pf-rehydrated';

/**
 * Every placeholder span we have wrapped, so a single toggle can flip all
 * of them at once. Held weakly by nothing -- the list is cleared when the
 * page goes away, and it only holds nodes already in the document.
 */
interface Wrapped {
  span: HTMLElement;
  token: string;
  value: string;
  /** Per-span reveal, independent of the global toggle. */
  shown: boolean;
  /** The chip painted over this span, kept across frames so it can be moved. */
  chip: HTMLElement | null;
  /** Last painted position, so a frame that changed nothing writes nothing. */
  at: string;
  /** Width the real value needs, measured once against the span's own font. */
  width: number;
  /** The CSS font shorthand that width was measured in. */
  font: string;
  /** The page's text colour where this span sits. */
  color: string;
  /** Whether the span is currently holding that width open. */
  reserved: boolean;
  /** Last verdict from the ancestor clip walk. See paintable(). */
  clipped: boolean;
}
const wrapped: Wrapped[] = [];
let revealAll = false;

/**
 * Real values are drawn in OUR shadow layer, never written into the page.
 *
 * The obvious implementation -- swap the span's textContent to the real
 * value -- hands the value straight to the host page's DOM, where the
 * site's own JavaScript can read it with one querySelectorAll. That defeats
 * the entire point: we redacted precisely so the recipient would not get
 * this data. So the placeholder text in the page never changes, and the
 * real value is painted on top, positioned with getClientRects exactly like
 * the inline highlights.
 */
let overlay: HTMLElement | null = null;

function overlayHost(): HTMLElement {
  if (overlay?.isConnected) return overlay;
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  getLayer().append(overlay);
  return overlay;
}

/** Text measurement, so a revealed value can reserve the room it needs. */
let ruler: CanvasRenderingContext2D | null | undefined;

const CHIP_PAD = 5;

/**
 * The font the chip will be drawn in, and how wide the value is in it.
 *
 * Both come from one string on purpose: measuring in the span's weight and
 * then drawing in a heavier one makes the value overflow the gap reserved for
 * it, which is how the first attempt at this left a few characters of the
 * real value hanging outside the chip.
 */
function measure(w: Wrapped): void {
  if (ruler === undefined) ruler = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(w.span);
  w.font = `${cs.fontStyle} 600 ${cs.fontSize}/1 ${cs.fontFamily}`;
  // The page's own text colour, read before the token is hidden. The chip is
  // a wash rather than a solid block, so the value has to read as the page's
  // text does -- light on a dark site, dark on a light one.
  w.color = cs.color;
  if (!ruler) {
    w.width = w.value.length * (parseFloat(cs.fontSize) || 14) * 0.62 + CHIP_PAD * 2;
    return;
  }
  ruler.font = w.font;
  w.width = Math.ceil(ruler.measureText(w.value).width) + CHIP_PAD * 2 + 2;
}

/**
 * Is the span clipped out of sight by something above it?
 *
 * A message is usually in the page more than once: the visible copy, plus a
 * screen-reader copy in the usual `width:1px;overflow:hidden;clip` box. The
 * hidden copy is not display:none and its own rect is full width -- the text
 * is laid out, then clipped by the container -- so it passes every cheap
 * visibility test and gets a value painted on it. That is where the chips
 * floating in empty space came from.
 *
 * So walk up and intersect with every ancestor that clips. This also stops a
 * chip from being drawn over a sticky header when the message it belongs to
 * has scrolled under it.
 */
function clippedAway(span: HTMLElement, rect: DOMRect): boolean {
  let node = span.parentElement;
  for (let depth = 0; node && depth < 40; depth++, node = node.parentElement) {
    const cs = getComputedStyle(node);
    const clips =
      cs.overflowX !== 'visible' ||
      cs.overflowY !== 'visible' ||
      cs.clip !== 'auto' ||
      cs.clipPath !== 'none';
    if (!clips) continue;
    const box = node.getBoundingClientRect();
    const w = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
    const h = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
    if (w < 6 || h < 6) return true;
  }
  return false;
}

/**
 * Is this span somewhere a chip can honestly be painted?
 *
 * `deep` runs the ancestor clip walk, which costs a computed style per
 * ancestor. Whether a copy of a message is a hidden one does not change frame
 * to frame, so the per-frame path trusts the last verdict and only the
 * events that can change it -- scroll, resize, a new wrap, the toggle --
 * pay for a fresh one.
 */
function paintable(w: Wrapped, deep: boolean): DOMRect | null {
  const span = w.span;
  const check = (span as { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (
    typeof check === 'function' &&
    !check.call(span, { checkOpacity: true, checkVisibilityCSS: true })
  ) {
    return null;
  }
  const rect = span.getBoundingClientRect();
  if (rect.width < 6 || rect.height < 6) return null;
  if (rect.bottom <= 0 || rect.top >= window.innerHeight) return null;
  if (rect.right <= 0 || rect.left >= window.innerWidth) return null;
  if (deep) w.clipped = clippedAway(span, rect);
  return w.clipped ? null : rect;
}

/**
 * Give the span the width of the real value while it is revealed.
 *
 * The chip is drawn on top of the token, and the real value is almost always
 * longer than "[SSN_1]", so without this the chip spills over whatever text
 * follows it. Reserving the width makes the page reflow around the reveal and
 * the chip land in a gap of exactly its own size. Only the width goes into
 * the page -- never the value.
 */
function reserve(w: Wrapped, on: boolean): void {
  if (on === w.reserved) return;
  w.reserved = on;
  if (on) {
    if (!w.width) measure(w);
    w.span.style.display = 'inline-block';
    w.span.style.minWidth = `${w.width}px`;
    // Hide the token, keep its box. The chip on top is a translucent wash
    // now, so without this the placeholder shows through the real value.
    w.span.style.color = 'transparent';
  } else {
    w.span.style.removeProperty('display');
    w.span.style.removeProperty('min-width');
    w.span.style.removeProperty('color');
  }
}

function drop(w: Wrapped): void {
  w.chip?.remove();
  w.chip = null;
  w.at = '';
}

export function repaintReveals(): void {
  paint(true);
}

function paint(deep: boolean): void {
  const host = overlayHost();
  let pruned = false;

  for (let i = wrapped.length - 1; i >= 0; i--) {
    const w = wrapped[i];
    if (!w) continue;

    // A re-render replaces the node we wrapped. The old span is still in our
    // list, still counted, and will be wrapped again in its new home -- so
    // drop it here or the count climbs every time the page redraws.
    if (!w.span.isConnected) {
      drop(w);
      wrapped.splice(i, 1);
      pruned = true;
      continue;
    }

    const show = revealAll || w.shown;
    if (!show) {
      reserve(w, false);
      drop(w);
      continue;
    }

    // A copy we already know is hidden never reserves again, so a scroll does
    // not write two styles into the page for every hidden duplicate.
    if (!w.clipped) reserve(w, true);
    const rect = paintable(w, deep || !w.chip);
    if (!rect) {
      // A hidden copy gives its width back; a span that is merely scrolled
      // out of view keeps it, so the text does not jump when it returns.
      if (w.clipped) reserve(w, false);
      drop(w);
      continue;
    }

    if (!w.chip) {
      const chip = document.createElement('span');
      chip.textContent = w.value;
      // A violet wash, not a solid block: the value should read as part of
      // the conversation with our mark on it, rather than as a sticker over
      // the top of it.
      chip.style.cssText =
        `position:fixed;left:0;top:0;` +
        `display:inline-flex;align-items:center;justify-content:center;` +
        `padding:0 ${CHIP_PAD}px;border-radius:4px;` +
        `background:rgba(91,63,209,.30);box-shadow:inset 0 0 0 1px rgba(122,95,236,.55);` +
        `color:${w.color};font:${w.font};white-space:nowrap;pointer-events:none;`;
      w.chip = chip;
      host.append(chip);
    }

    // Positioned with a transform rather than left/top: the value has to keep
    // up with text that moves every frame while a response streams in, and a
    // transform costs no layout.
    const at = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
    if (at !== w.at) {
      w.at = at;
      w.chip.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      // min-width, not width: if the measurement was a hair short the chip
      // grows rather than clipping a digit off the value.
      w.chip.style.minWidth = `${rect.width}px`;
      w.chip.style.height = `${rect.height}px`;
    }
  }

  if (pruned) onCountChange?.(revealedCount());
  track();
}

/**
 * While anything is revealed, follow the text every frame.
 *
 * Scroll and resize are not the only things that move a message. A streaming
 * response reflows the whole thread continuously, and a chip painted once at
 * submit time ends up sitting over unrelated text further up the page.
 */
let frame = 0;

function track(): void {
  const wanted = revealAll || wrapped.some((w) => w.shown);
  if (!wanted || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    paint(false);
  });
}

/**
 * Flip every placeholder between token and real value.
 *
 * Nothing is fetched and nothing is sent: the mapping has been in this
 * page's memory since the redaction happened, and the revealed text is
 * rendered in our own shadow root rather than in the conversation.
 */
export function setRevealAll(on: boolean): void {
  revealAll = on;
  repaintReveals();
}

/**
 * How many redacted items are on the page -- not how many spans we wrapped.
 *
 * The same message is often in the DOM several times over (a screen-reader
 * copy, a mid-stream duplicate), so counting spans made the toggle claim
 * "Show real values (6)" for two redactions.
 */
export function revealedCount(): number {
  return new Set(wrapped.map((w) => w.token)).size;
}

function wrap(textNode: Text, placeholders: Map<string, Placeholder>): void {
  const text = textNode.nodeValue ?? '';
  PLACEHOLDER_PATTERN.lastIndex = 0;
  if (!PLACEHOLDER_PATTERN.test(text)) return;

  PLACEHOLDER_PATTERN.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let cursor = 0;

  for (const m of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (m.index === undefined) continue;
    const token = m[1];
    if (token === undefined) continue;
    const known = placeholders.get(token);
    if (!known) continue;

    if (m.index > cursor) frag.append(text.slice(cursor, m.index));

    const span = document.createElement('span');
    span.setAttribute(MARKED, '');
    span.textContent = m[0];
    // Deliberately NOT the real value. A title attribute is readable by the
    // host page at any time, so putting it here would leak every mapping
    // passively, without the user ever revealing anything.
    span.title = 'Redacted — click to reveal locally';
    // Violet wash plus a solid rule under it, and the page's own text colour:
    // the same marking as the rest of the extension, and legible whether the
    // site is in light or dark mode.
    span.style.cssText =
      'background:rgba(91,63,209,.20);box-shadow:inset 0 -2px 0 #5b3fd1;' +
      'border-radius:3px;padding:0 3px;cursor:pointer;';

    const entry: Wrapped = {
      span,
      token,
      value: known.value,
      shown: false,
      chip: null,
      at: '',
      width: 0,
      font: '',
      color: '',
      reserved: false,
      clipped: false,
    };
    wrapped.push(entry);

    span.addEventListener('click', () => {
      entry.shown = !entry.shown;
      repaintReveals();
    });
    frag.append(span);
    cursor = m.index + m[0].length;
  }

  if (cursor === 0) return;
  frag.append(text.slice(cursor));
  textNode.replaceWith(frag);
}

/**
 * Find placeholder text anywhere on the page, rather than trusting a
 * selector for "the assistant's message".
 *
 * The original version walked nodes matched by three guessed selectors. When
 * a site changes its markup those match nothing, rehydration silently does
 * nothing, and the reveal toggle appears broken. Placeholders are a
 * distinctive shape -- [PERSON_1] -- so scanning the document and skipping
 * the parts we must not touch is both simpler and far more durable.
 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);

function walk(root: HTMLElement, placeholders: Map<string, Placeholder>, skip: Element[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      // Never touch our own UI, and never touch the composer -- rewriting
      // text the user is editing would corrupt the editor.
      if (skip.some((s) => s.contains(parent))) return NodeFilter.FILTER_REJECT;
      if (parent.hasAttribute(MARKED)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    nodes.push(n as Text);
    n = walker.nextNode();
  }
  for (const node of nodes) wrap(node, placeholders);
}

/**
 * Watches for new assistant messages and annotates placeholders in them.
 * Runs on a settle delay rather than per mutation so we never wrap a token
 * that has only half arrived.
 */
let onCountChange: ((n: number) => void) | null = null;

/** Notified when more placeholders become visible, so the toggle can update. */
export function setWrappedCountHandler(fn: (n: number) => void): void {
  onCountChange = fn;
}

export function startRehydration(
  adapter: ComposerAdapter,
  getPlaceholders: () => Promise<Placeholder[]>,
): () => void {
  let timer: number | undefined;

  const settle = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void (async () => {
        const list = await getPlaceholders();
        if (!list.length) return;
        const map = new Map(list.map((p) => [p.token, p]));

        const skip: Element[] = [];
        const composer = adapter.getComposer();
        if (composer) skip.push(composer);
        const ourHost = document.getElementById('deadbolt-root');
        if (ourHost) skip.push(ourHost);

        const before = wrapped.length;
        walk(document.body, map, skip);
        if (wrapped.length !== before) {
          console.info(
            `[deadbolt] rehydrate: wrapped ${wrapped.length - before} placeholder(s), ` +
              `${revealedCount()} item(s) on the page`,
          );
          onCountChange?.(revealedCount());
          // A placeholder that arrives while the toggle is already on has to
          // be painted now, not at the next scroll.
          repaintReveals();
        }
      })();
    }, 400);
  };

  const observer = new MutationObserver(settle);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  settle();

  return () => {
    observer.disconnect();
    window.clearTimeout(timer);
  };
}
