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
    span.title = known.value;
    span.style.cssText =
      'background:#2a2118;color:#f0b429;border-radius:3px;padding:0 3px;cursor:help;';
    // Click reveals inline, for the case where a tooltip will not show on a
    // projector or in a screen recording.
    span.addEventListener('click', () => {
      span.textContent = span.textContent === m[0] ? known.value : m[0];
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
