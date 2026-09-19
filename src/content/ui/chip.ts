/**
 * The routing hint. A dismissible inline chip and nothing more -- it never
 * intercepts a keystroke, and pressing Enter dismisses it and sends normally.
 *
 * Routing suggests; privacy guards.
 */
import type { ChipOptions } from '../../shared/messages';
import { el, getLayer } from './shell';

let current: HTMLElement | null = null;

export function showChip(opts: ChipOptions, anchor: HTMLElement | null): void {
  dismissChip();

  const accept = el('button', { class: 'pf primary', style: 'padding:3px 9px;font-size:12px;' }, 'Try that');
  const no = el('button', { class: 'pf', style: 'padding:3px 9px;font-size:12px;' }, 'Dismiss');
  accept.addEventListener('click', () => {
    opts.onAccept();
    dismissChip();
  });
  no.addEventListener('click', () => {
    opts.onDismiss();
    dismissChip();
  });

  const rect = anchor?.getBoundingClientRect();
  const top = rect ? Math.max(8, rect.top - 46) : 80;
  const left = rect ? rect.left : 24;

  const chip = el(
    'div',
    {
      class: 'card',
      style: `position:absolute;top:${top}px;left:${left}px;padding:7px 10px;display:flex;align-items:center;gap:10px;font-size:12.5px;`,
    },
    el('span', { class: 'muted' }, opts.decision.reason),
    accept,
    no,
  );

  getLayer().append(chip);
  current = chip;
}

export function dismissChip(): void {
  current?.remove();
  current = null;
}
