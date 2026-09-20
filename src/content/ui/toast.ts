/**
 * The post-send toast: "4 items redacted · Undo · See what changed".
 *
 * It appears AFTER the message is sent, never before, because the design
 * principle is that we do not stand between the user and Enter. Undo restores
 * the original text to the composer and deliberately does not resend.
 */
import type { ToastOptions } from '../../shared/messages';
import { el, getDock, lockLogo } from './shell';

const AUTO_DISMISS_MS = 9000;

let current: HTMLElement | null = null;

export function showToast(opts: ToastOptions): () => void {
  dismissToast();

  const byLabel = new Map<string, number>();
  for (const p of opts.placeholders) {
    const stem = p.token.replace(/_\d+$/, '').replaceAll('_', ' ').toLowerCase();
    byLabel.set(stem, (byLabel.get(stem) ?? 0) + 1);
  }
  const summary = [...byLabel.entries()].map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ');

  const undo = el('button', { class: 'pfl', type: 'button' }, 'Undo');
  const diff = el('button', { class: 'pfl primary', type: 'button' }, 'See what changed');

  const card = el(
    'div',
    {
      // pf-card and pfl, the same violet-and-green surface as the live scan
      // and the diff. The toast is the thing people see most, so it is the
      // last place that should look like a different product.
      class: 'pf-card',
      // order 3: the toast sits at the bottom of the right dock, closest to
      // the composer, because it is about the message just sent.
      style:
        'order:3;width:340px;max-width:100%;padding:14px 16px;display:flex;flex-direction:column;gap:10px;',
    },
    // Sizes are in em: the dock sets the type size from the room it has, so a
    // narrow gutter makes this smaller rather than squeezing it.
    el(
      'div',
      { style: 'display:flex;align-items:center;gap:9px;flex-wrap:wrap;' },
      lockLogo(20),
      el('strong', { style: 'font-size:1.08em;' }, `${opts.placeholders.length} redacted`),
      el('span', { class: 'pf-muted', style: 'font-size:.92em;' }, 'sent safely'),
    ),
    el('div', { class: 'pf-muted', style: 'font-size:.96em;line-height:1.45;' }, summary),
    // Wraps: in a narrow gutter the two buttons do not fit on one line.
    el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;' }, undo, diff),
  );

  undo.addEventListener('click', () => {
    opts.onUndo();
    dismissToast();
  });
  diff.addEventListener('click', () => opts.onOpenDiff());

  getDock('right').append(card);
  current = card;
  const timer = window.setTimeout(dismissToast, AUTO_DISMISS_MS);

  return () => {
    window.clearTimeout(timer);
    dismissToast();
  };
}

export function dismissToast(): void {
  current?.remove();
  current = null;
}
