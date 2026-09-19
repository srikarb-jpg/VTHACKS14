/**
 * The post-send toast: "4 items redacted · Undo · See what changed".
 *
 * It appears AFTER the message is sent, never before, because the design
 * principle is that we do not stand between the user and Enter. Undo restores
 * the original text to the composer and deliberately does not resend.
 */
import type { ToastOptions } from '../../shared/messages';
import { el, getLayer } from './shell';

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

  const undo = el('button', { class: 'pf' }, 'Undo');
  const diff = el('button', { class: 'pf primary' }, 'See what changed');

  const card = el(
    'div',
    {
      class: 'card',
      style:
        'position:absolute;right:24px;bottom:24px;width:340px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;',
    },
    el(
      'div',
      { style: 'display:flex;align-items:baseline;gap:8px;' },
      el('strong', { style: 'font-size:14px;' }, `${opts.placeholders.length} redacted`),
      el('span', { class: 'muted', style: 'font-size:12px;' }, 'sent safely'),
    ),
    el('div', { class: 'muted', style: 'font-size:12.5px;line-height:1.45;' }, summary),
    el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;' }, undo, diff),
  );

  undo.addEventListener('click', () => {
    opts.onUndo();
    dismissToast();
  });
  diff.addEventListener('click', () => opts.onOpenDiff());

  getLayer().append(card);
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
