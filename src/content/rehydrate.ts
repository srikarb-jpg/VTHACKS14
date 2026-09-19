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
}
const wrapped: Wrapped[] = [];
let revealAll = false;

function paint(w: Wrapped): void {
  w.span.textContent = revealAll ? w.value : `[${w.token}]`;
  w.span.style.background = revealAll ? '#16301f' : '#2a2118';
  w.span.style.color = revealAll ? '#7ee2a8' : '#f0b429';
}

/**
 * Flip every placeholder in the conversation between token and real value.
 *
 * Nothing is fetched and nothing is sent: the mapping has been in this
 * page's memory since the redaction happened. Revealing is a local
 * rendering choice, which is the whole point of redacting reversibly.
 */
export function setRevealAll(on: boolean): void {
  revealAll = on;
  for (const w of wrapped) paint(w);
}

export function revealedCount(): number {
  return wrapped.length;
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
    span.title = `${known.value} — click to toggle`;
    span.style.cssText = 'border-radius:3px;padding:0 3px;cursor:pointer;transition:all .12s;';

    const entry: Wrapped = { span, token, value: known.value };
    wrapped.push(entry);
    paint(entry);

    // Individual click still works, for revealing one value on a projector
    // without exposing the rest.
    span.addEventListener('click', () => {
      const showing = span.textContent === known.value;
      span.textContent = showing ? `[${token}]` : known.value;
      span.style.background = showing ? '#2a2118' : '#16301f';
      span.style.color = showing ? '#f0b429' : '#7ee2a8';
    });
    frag.append(span);
    cursor = m.index + m[0].length;
  }

  if (cursor === 0) return;
  frag.append(text.slice(cursor));
  textNode.replaceWith(frag);
}

function walk(root: HTMLElement, placeholders: Map<string, Placeholder>): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    if (!(n.parentElement?.hasAttribute(MARKED) ?? false)) nodes.push(n as Text);
    n = walker.nextNode();
  }
  for (const node of nodes) wrap(node, placeholders);
}

/**
 * Watches for new assistant messages and annotates placeholders in them.
 * Runs on a settle delay rather than per mutation so we never wrap a token
 * that has only half arrived.
 */
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
        for (const node of adapter.getResponseNodes()) walk(node, map);
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
