/**
 * The redaction diff. This is the demo moment, so it is worth more polish
 * than anything else in the UI: original on the left, redacted on the right,
 * every change clickable to put the real value back.
 *
 * A replaced item is drawn as a redaction chip, in the same shape language as
 * the popup and dashboard: filled for high severity, outlined for medium.
 *
 * Rendering is span-based rather than string-replacement based so that a
 * value appearing twice highlights in both places.
 */
import type { DiffOptions } from '../../shared/messages';
import type { Placeholder } from '../../shared/types';
import { wrapToken } from '../../shared/config';
import { KIND_INFO } from '../../shared/stats';
import { el, getLayer, lockLogo } from './shell';

let scrim: HTMLElement | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;

function renderOriginal(text: string, placeholders: Placeholder[]): HTMLElement {
  const box = el('div', { class: 'pf-pane' });
  // Find every occurrence of every redacted value, then paint the gaps.
  const hits: { start: number; end: number }[] = [];
  for (const p of placeholders) {
    let i = text.indexOf(p.value);
    while (i !== -1) {
      hits.push({ start: i, end: i + p.value.length });
      i = text.indexOf(p.value, i + p.value.length);
    }
  }
  hits.sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    if (h.start > cursor) box.append(text.slice(cursor, h.start));
    box.append(el('span', { class: 'pf-orig' }, text.slice(h.start, h.end)));
    cursor = h.end;
  }
  box.append(text.slice(cursor));
  return box;
}

function renderRedacted(
  text: string,
  placeholders: Placeholder[],
  onRevert: (token: string) => void,
): HTMLElement {
  const box = el('div', { class: 'pf-pane' });
  // Split on any wrapped token, keeping the tokens.
  const pattern = new RegExp(
    `(${placeholders.map((p) => wrapToken(p.token).replace(/[[\]]/g, '\\$&')).join('|')})`,
    'g',
  );
  const parts = placeholders.length ? text.split(pattern) : [text];
  for (const part of parts) {
    const match = placeholders.find((p) => wrapToken(p.token) === part);
    if (!match) {
      box.append(part);
      continue;
    }
    // Filled = high severity, outlined = medium, dotted = the highlight tier.
    const tier = KIND_INFO[match.kind].tier;
    const chip = el(
      'span',
      {
        class: `pf-chip ${tier === 'block' ? 'high' : tier}`,
        title: 'Click to put the real value back',
        role: 'button',
        tabindex: '0',
      },
      part,
    );
    const revert = (): void => onRevert(match.token);
    chip.addEventListener('click', revert);
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        revert();
      }
    });
    box.append(chip);
  }
  return box;
}

const ARROW =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" ' +
  'stroke="#1e1247" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

export function showDiff(opts: DiffOptions): void {
  // Each revert re-renders the whole panel. Only animate the first opening, or
  // it would pop again on every click.
  const reopening = scrim !== null;
  closeDiff();

  const doClose = (): void => {
    opts.onClose();
    closeDiff();
  };

  const close = el('button', { class: 'pfl', type: 'button' }, 'Close');
  close.addEventListener('click', doClose);

  const column = (title: string, sub: string, pane: HTMLElement): HTMLElement =>
    el('div', { class: 'pf-col' }, el('div', { class: 'pf-col-title' }, title), el('div', { class: 'pf-col-sub' }, sub), pane);

  const arrow = el('div', { class: 'pf-arrow', 'aria-hidden': 'true' });
  arrow.innerHTML = ARROW; // a constant, never user text

  const n = opts.placeholders.length;
  const summary = n ? `${n} item${n === 1 ? '' : 's'} replaced` : 'Everything was put back';

  const card = el(
    'div',
    { class: 'pf-card pf-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pf-diff-title' },
    el(
      'div',
      { class: 'pf-modal-head' },
      lockLogo(44),
      el(
        'div',
        { class: 'pf-modal-titles' },
        el('div', { class: 'pf-modal-title', id: 'pf-diff-title' }, 'What left your machine'),
        el('div', { class: 'pf-modal-sub' }, 'Click any highlighted item to put the original back.'),
      ),
      close,
    ),
    el(
      'div',
      { class: 'pf-modal-body' },
      column('You typed', 'The original. It never left this device.', renderOriginal(opts.original, opts.placeholders)),
      arrow,
      column('We sent', 'What the chat site received.', renderRedacted(opts.redacted, opts.placeholders, opts.onRevert)),
    ),
    el(
      'div',
      { class: 'pf-modal-foot' },
      el('span', {}, el('strong', {}, summary)),
      el('span', {}, 'This comparison is only in memory. Nothing here is saved.'),
    ),
  );

  scrim = el('div', { class: `pf-scrim${reopening ? '' : ' pf-enter'}` }, card);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) doClose();
  });
  getLayer().append(scrim);

  // Escape closes, and is swallowed so it does not also reach the chat site.
  onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    doClose();
  };
  document.addEventListener('keydown', onKey, true);

  if (!reopening) close.focus();
}

export function closeDiff(): void {
  if (onKey) document.removeEventListener('keydown', onKey, true);
  onKey = null;
  scrim?.remove();
  scrim = null;
}
