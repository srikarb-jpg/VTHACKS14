/**
 * The reveal toggle, and the brief "working" indicator at submit.
 *
 * Redaction is only comfortable if the user can see through it. The prompt
 * that left the machine says [PERSON_1]; the answer that comes back says
 * [PERSON_1]; and one click puts "Amanda Britfield" back on screen without
 * anything leaving the device, because the mapping never left it either.
 */
import { el, getLayer } from './shell';

let bar: HTMLElement | null = null;
let label: Text | null = null;
let revealed = false;
let onToggle: ((revealed: boolean) => void) | null = null;

export function setRevealHandler(fn: (revealed: boolean) => void): void {
  onToggle = fn;
}

export function isRevealed(): boolean {
  return revealed;
}

/** Shows the toggle. Idempotent; call whenever the placeholder count changes. */
export function showRevealToggle(count: number): void {
  if (count === 0) {
    hideRevealToggle();
    return;
  }

  if (!bar) {
    label = document.createTextNode('');
    const btn = el(
      'button',
      { class: 'pf', style: 'display:flex;align-items:center;gap:7px;' },
      el('span', { style: 'font-size:13px;' }, '◉'),
      el('span', {}, label),
    );
    btn.addEventListener('click', () => {
      revealed = !revealed;
      onToggle?.(revealed);
      paint(count);
    });
    bar = el(
      'div',
      { style: 'position:absolute;right:24px;bottom:84px;' },
      btn,
    );
    getLayer().append(bar);
  }
  paint(count);
}

function paint(count: number): void {
  if (!label || !bar) return;
  label.nodeValue = revealed ? `Hide real values (${count})` : `Show real values (${count})`;
  const btn = bar.firstElementChild as HTMLElement | null;
  if (btn) btn.className = revealed ? 'pf primary' : 'pf';
}

export function hideRevealToggle(): void {
  bar?.remove();
  bar = null;
  label = null;
}

// ---------------------------------------------------------------------------

let pending: HTMLElement | null = null;

/**
 * Shown while the submit path waits on the model. Brief by construction --
 * the wait is bounded at 2.5s -- but without it the Enter key appears to do
 * nothing, which is worse than a visible pause.
 */
export function showPending(text: string): void {
  hidePending();
  pending = el(
    'div',
    {
      class: 'card',
      style:
        'position:absolute;right:24px;bottom:24px;padding:10px 14px;display:flex;' +
        'align-items:center;gap:9px;font-size:12.5px;',
    },
    el('span', { class: 'muted' }, text),
  );
  getLayer().append(pending);
}

export function hidePending(): void {
  pending?.remove();
  pending = null;
}
