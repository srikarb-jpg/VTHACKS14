/**
 * Placeholders inside form fields.
 *
 * rehydrate.ts finds tokens by walking text nodes, and a field's text is not
 * a text node: it is the element's `value`, which a TreeWalker never visits.
 * That is what left claude.ai's email-draft card (a subject <input> and a body
 * <textarea>) showing [PERSON_1] with no way to see through it.
 *
 * The same rule applies as everywhere else: the real value is never written
 * into the page. Each field with tokens in it gets a mirror -- a div in our
 * shadow layer, styled like the field and sitting exactly on top of it.
 *
 *  - Not revealed: the mirror carries the field's own text, invisibly, and
 *    washes the tokens in violet, so they are marked the way they are in the
 *    conversation.
 *  - Revealed: the mirror draws the text with the real values in, and the
 *    field's own text is made transparent so the two do not double up. Only a
 *    colour goes into the page, never a value. The mirror flows the real text,
 *    so a long value wraps the way it would if it had been typed there.
 *
 * Nothing here takes input: the mirror ignores the pointer, so the field stays
 * an ordinary, editable field underneath.
 */
import type { Placeholder } from '../shared/types';
import { PLACEHOLDER_PATTERN } from '../shared/config';
import { getLayer } from './ui/shell';
import { partlyCovered } from './occlusion';

type Field = HTMLInputElement | HTMLTextAreaElement;

interface Tracked {
  el: Field;
  mirror: HTMLElement;
  /** What the mirror's content was last built from, so a frame that changed nothing rebuilds nothing. */
  built: string;
  /** Known tokens currently in the value. */
  tokens: Set<string>;
  /** Whether the field's own text is currently made transparent by us. */
  concealed: boolean;
  /** The field's text colour from before we hid it. */
  color: string;
  /** Inline values to give back on unconceal. */
  prevColor: string;
  prevCaret: string;
}

const tracked = new Map<Field, Tracked>();
let known = new Map<string, Placeholder>();
let host: HTMLElement | null = null;

const MARKED = 'background:rgba(91,63,209,.20);box-shadow:inset 0 -2px 0 #5b3fd1;border-radius:3px;';
const REVEALED =
  'background:rgba(91,63,209,.30);box-shadow:inset 0 0 0 1px rgba(122,95,236,.55);border-radius:4px;';

/** Everything that decides where a character lands, copied from the field. */
const COPY = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
  'letter-spacing', 'word-spacing', 'text-transform', 'text-indent', 'text-align',
  'text-rendering', 'line-height', 'tab-size', 'direction', 'word-break', 'overflow-wrap',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
] as const;

const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', '']);

function isTextField(el: Element): el is Field {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_TYPES.has(el.type);
}

function fieldHost(): HTMLElement {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  getLayer().append(host);
  return host;
}

function tokensIn(value: string): Set<string> {
  const out = new Set<string>();
  for (const m of value.matchAll(PLACEHOLDER_PATTERN)) {
    if (m[1] !== undefined && known.has(m[1])) out.add(m[1]);
  }
  return out;
}

/**
 * Track every text field under `root` that has a known token in it. Returns
 * how many were added. Called from the settle scan, so it runs after the page
 * has finished changing rather than on every mutation.
 */
export function scanFields(
  root: HTMLElement,
  placeholders: Map<string, Placeholder>,
  skip: Element[],
): number {
  known = placeholders;
  let added = 0;
  for (const el of root.querySelectorAll('textarea, input')) {
    if (!isTextField(el) || tracked.has(el)) continue;
    if (skip.some((s) => s.contains(el))) continue;
    const tokens = tokensIn(el.value);
    if (!tokens.size) continue;
    tracked.set(el, {
      el,
      mirror: document.createElement('div'),
      built: '',
      tokens,
      concealed: false,
      color: '',
      prevColor: '',
      prevCaret: '',
    });
    added++;
  }
  return added;
}

export function fieldCount(): number {
  return tracked.size;
}

/** Tokens present across every tracked field, for the reveal toggle's count. */
export function fieldTokens(): Set<string> {
  const all = new Set<string>();
  for (const t of tracked.values()) for (const tok of t.tokens) all.add(tok);
  return all;
}

export function isTrackedField(target: EventTarget | null): boolean {
  return target instanceof Element && isTextField(target) && tracked.has(target);
}

function fill(t: Tracked, value: string, reveal: boolean): void {
  const key = `${reveal ? 1 : 0}|${value}`;
  if (t.built === key) return;
  t.built = key;

  const m = t.mirror;
  m.textContent = '';
  let cursor = 0;
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    const real = match[1] === undefined ? undefined : known.get(match[1]);
    if (!real || match.index === undefined) continue;
    if (match.index > cursor) m.append(value.slice(cursor, match.index));
    const span = document.createElement('span');
    span.textContent = reveal ? real.value : match[0];
    span.style.cssText = reveal ? REVEALED : MARKED;
    m.append(span);
    cursor = match.index + match[0].length;
  }
  m.append(value.slice(cursor));
}

function conceal(t: Tracked, cs: CSSStyleDeclaration): void {
  if (t.concealed) return;
  t.concealed = true;
  t.color = cs.color;
  t.prevColor = t.el.style.color;
  t.prevCaret = t.el.style.caretColor;
  t.el.style.color = 'transparent';
  // The caret follows currentColor by default, and would go with the text.
  t.el.style.caretColor = t.color;
}

function unconceal(t: Tracked): void {
  if (!t.concealed) return;
  t.concealed = false;
  if (t.prevColor) t.el.style.color = t.prevColor;
  else t.el.style.removeProperty('color');
  if (t.prevCaret) t.el.style.caretColor = t.prevCaret;
  else t.el.style.removeProperty('caret-color');
}

function release(t: Tracked): void {
  unconceal(t);
  t.mirror.remove();
}

/**
 * The part of a box that is actually on screen: the viewport and every
 * clipping ancestor intersected with it. Null when none of it is. The mirror
 * is drawn in a fixed layer and would otherwise float over a header the field
 * has scrolled under.
 */
function visibleBox(el: Element, box: DOMRect, height: number) {
  let left = Math.max(box.left, 0);
  let top = Math.max(box.top, 0);
  let right = Math.min(box.right, window.innerWidth);
  let bottom = Math.min(box.top + height, window.innerHeight);
  let node = el.parentElement;
  for (let depth = 0; node && depth < 40; depth++, node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.display === 'contents') continue;
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = node.getBoundingClientRect();
    left = Math.max(left, r.left);
    top = Math.max(top, r.top);
    right = Math.min(right, r.right);
    bottom = Math.min(bottom, r.bottom);
  }
  return right - left < 1 || bottom - top < 1 ? null : { left, top, right, bottom };
}

/**
 * Bring every tracked field up to date. Returns whether the set of tokens on
 * the page changed, so the reveal toggle's count can follow.
 */
export function paintFields(reveal: boolean): boolean {
  if (!tracked.size) return false;
  const layer = fieldHost();
  let changed = false;

  for (const [el, t] of tracked) {
    if (!el.isConnected) {
      release(t);
      tracked.delete(el);
      changed = true;
      continue;
    }

    const tokens = tokensIn(el.value);
    if (tokens.size !== t.tokens.size || [...tokens].some((x) => !t.tokens.has(x))) changed = true;
    t.tokens = tokens;

    const rect = el.getBoundingClientRect();
    const check = (el as { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    const shown =
      tokens.size > 0 &&
      rect.width >= 1 &&
      rect.height >= 1 &&
      (typeof check !== 'function' || check.call(el, { checkVisibilityCSS: true }));
    if (!shown) {
      unconceal(t);
      t.mirror.remove();
      continue;
    }

    const cs = getComputedStyle(el);
    const m = t.mirror;
    if (!m.isConnected) layer.append(m);

    // Copy the metrics first, then override the parts that are ours.
    for (const p of COPY) m.style.setProperty(p, cs.getPropertyValue(p));
    const multiline = el instanceof HTMLTextAreaElement;
    const width = el.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    const scrolls = multiline && el.scrollHeight > el.clientHeight + 1;
    // An <input> centres its line in the box; a div starts at the top.
    const lineHeight = multiline
      ? ''
      : `${el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)}px`;
    if (lineHeight) m.style.setProperty('line-height', lineHeight);

    if (reveal) conceal(t, cs);
    else unconceal(t);

    m.style.position = 'fixed';
    m.style.left = '0';
    m.style.top = '0';
    m.style.margin = '0';
    m.style.boxSizing = 'border-box';
    m.style.border = 'solid transparent';
    for (const side of ['top', 'right', 'bottom', 'left']) {
      m.style.setProperty(`border-${side}-width`, cs.getPropertyValue(`border-${side}-width`));
    }
    m.style.width = `${width}px`;
    m.style.whiteSpace = multiline ? cs.whiteSpace : 'pre';
    m.style.overflow = 'hidden';
    m.style.pointerEvents = 'none';
    m.style.color = t.concealed ? t.color : 'transparent';
    // A field that scrolls inside itself keeps its own height and follows its
    // scroll. One that grows to fit its text (field-sizing: content) lets the
    // mirror grow too, so a value longer than its token is not cut off.
    m.style.height = scrolls || !multiline ? `${rect.height}px` : 'auto';

    fill(t, el.value, t.concealed);
    m.scrollTop = el.scrollTop;
    m.scrollLeft = el.scrollLeft;

    const height = Math.max(rect.height, m.offsetHeight);
    const vis = visibleBox(el, rect, height);
    // Any part covered and the mirror stands down. It is drawn above the whole
    // page, so the alternative is text painted across a menu or the composer;
    // and it has to give the field its own text back, or the field would show
    // nothing at all while the mirror is away.
    const covered =
      vis &&
      partlyCovered(el, {
        left: vis.left,
        top: vis.top,
        width: vis.right - vis.left,
        height: vis.bottom - vis.top,
      });
    if (!vis || covered) {
      unconceal(t);
      m.style.display = 'none';
      continue;
    }
    m.style.display = 'block';
    m.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    m.style.clipPath =
      `inset(${vis.top - rect.top}px ${rect.left + width - vis.right}px ` +
      `${rect.top + height - vis.bottom}px ${vis.left - rect.left}px)`;
  }
  return changed;
}

/** Give every field its own text back and take the mirrors down. */
export function releaseFields(): void {
  for (const t of tracked.values()) release(t);
  tracked.clear();
  host?.remove();
  host = null;
}
