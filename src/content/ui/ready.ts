/**
 * The ready indicator.
 *
 * The product is meant to be invisible until it catches something, which is
 * correct for a user and hostile to a developer: an extension that is loaded
 * and idle looks exactly like one that failed to inject.
 *
 * So: a small pill, bottom-left, that fades to near-invisible after a few
 * seconds and reveals itself on hover. It also reports whether the composer
 * was actually found, which is the thing most likely to be broken after a
 * site-side markup change.
 */
import { el, getLayer } from './shell';

let pill: HTMLElement | null = null;
let dot: HTMLElement | null = null;
let labelNode: Text | null = null;

type State = 'armed' | 'no-composer';

const COLORS: Record<State, string> = {
  armed: '#3fbf7f',
  'no-composer': '#f0b429',
};

const LABELS: Record<State, string> = {
  armed: 'Prompt Firewall armed',
  'no-composer': 'Prompt Firewall — composer not found',
};

export function showReady(state: State): void {
  if (!pill) {
    dot = el('span', {
      style:
        'width:7px;height:7px;border-radius:50%;background:#3fbf7f;flex:0 0 auto;transition:background .2s;',
    });
    labelNode = document.createTextNode('');
    pill = el(
      'div',
      {
        class: 'card',
        style:
          'position:absolute;left:16px;bottom:16px;padding:5px 10px;display:flex;align-items:center;' +
          'gap:7px;font-size:11.5px;opacity:.95;transition:opacity .4s;cursor:default;',
      },
      dot,
      el('span', { class: 'muted' }, labelNode),
    );
    // Fade back once the developer has seen it, but keep it reachable.
    pill.addEventListener('mouseenter', () => pill && (pill.style.opacity = '.95'));
    pill.addEventListener('mouseleave', () => pill && (pill.style.opacity = '.12'));
    getLayer().append(pill);
    window.setTimeout(() => pill && (pill.style.opacity = '.12'), 4000);
  }

  if (dot) dot.style.background = COLORS[state];
  if (labelNode) labelNode.nodeValue = LABELS[state];
}
