/**
 * The reveal toggle, and the brief "working" indicator at submit.
 *
 * Redaction is only comfortable if the user can see through it. The prompt
 * that left the machine says [PERSON_1]; the answer that comes back says
 * [PERSON_1]; and one click puts "Amanda Britfield" back on screen without
 * anything leaving the device, because the mapping never left it either.
 */
import { el, getLayer, lockLogo } from './shell';

let bar: HTMLElement | null = null;
let label: Text | null = null;
let revealed = false;
/** Kept here, not in the click handler's closure, so the label stays truthful
 *  as more placeholders appear after the button was first drawn. */
let shownCount = 0;
let onToggle: ((revealed: boolean) => void) | null = null;

export function setRevealHandler(fn: (revealed: boolean) => void): void {
  onToggle = fn;
}

export function isRevealed(): boolean {
  return revealed;
}

/** An eye. A constant, never user text. */
function eye(): SVGElement {
  const t = document.createElement('template');
  t.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  return t.content.firstElementChild as SVGElement;
}

/** Shows the toggle. Idempotent; call whenever the placeholder count changes. */
export function showRevealToggle(count: number): void {
  if (count === 0) {
    hideRevealToggle();
    return;
  }

  shownCount = count;
  if (!bar) {
    label = document.createTextNode('');
    const btn = el('button', { class: 'pfl', type: 'button' }, eye(), el('span', {}, label));
    btn.addEventListener('click', () => {
      revealed = !revealed;
      onToggle?.(revealed);
      paint();
    });
    bar = el('div', { style: 'position:absolute;right:24px;bottom:84px;' }, btn);
    getLayer().append(bar);
  }
  paint();
}

function paint(): void {
  if (!label || !bar) return;
  const count = shownCount;
  label.nodeValue = revealed ? `Hide real values (${count})` : `Show real values (${count})`;
  const btn = bar.firstElementChild as HTMLElement | null;
  if (btn) {
    btn.className = revealed ? 'pfl primary' : 'pfl';
    btn.setAttribute('aria-pressed', String(revealed));
  }
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
 * nothing, which is worse than a visible pause. The lock bobs so the pause
 * reads as "working" and not "frozen".
 */
export function showPending(text: string): void {
  hidePending();
  pending = el(
    'div',
    {
      class: 'pf-card pf-status',
      role: 'status',
      style: 'position:absolute;right:24px;bottom:24px;',
    },
    lockLogo(24, 'pf-bob'),
    el('span', { class: 'pf-muted' }, text),
  );
  getLayer().append(pending);
}

export function hidePending(): void {
  pending?.remove();
  pending = null;
}
