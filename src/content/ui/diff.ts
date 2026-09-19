/**
 * The redaction diff. This is the demo moment, so it is worth more polish
 * than anything else in the UI: original on the left, redacted on the right,
 * every change clickable to put the real value back.
 *
 * Rendering is span-based rather than string-replacement based so that a
 * value appearing twice highlights in both places.
 */
import type { DiffOptions } from '../../shared/messages';
import type { Placeholder } from '../../shared/types';
import { wrapToken } from '../../shared/config';
import { el, getLayer } from './shell';

let current: HTMLElement | null = null;

function renderOriginal(text: string, placeholders: Placeholder[]): HTMLElement {
  const box = el('div', {
    class: 'mono',
    style: 'font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;',
  });
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
    box.append(el('span', { class: 'del' }, text.slice(h.start, h.end)));
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
  const box = el('div', {
    class: 'mono',
    style: 'font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;',
  });
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
    const chip = el('span', { class: 'tok', title: 'Click to put the real value back' }, part);
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', () => onRevert(match.token));
    box.append(chip);
  }
  return box;
}

export function showDiff(opts: DiffOptions): void {
  closeDiff();

  const close = el('button', { class: 'pf' }, 'Close');
  close.addEventListener('click', () => {
    opts.onClose();
    closeDiff();
  });

  const column = (title: string, body: HTMLElement) =>
    el(
      'div',
      { style: 'flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;' },
      el('div', { class: 'muted', style: 'font-size:11px;letter-spacing:.08em;text-transform:uppercase;' }, title),
      el('div', { style: 'flex:1;overflow:auto;padding:12px;background:#0f1115;border:1px solid #23262e;border-radius:8px;' }, body),
    );

  const card = el(
    'div',
    {
      class: 'card',
      style:
        'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(900px,92vw);height:min(560px,80vh);padding:18px;display:flex;flex-direction:column;gap:14px;',
    },
    el(
      'div',
      { style: 'display:flex;align-items:center;justify-content:space-between;' },
      el(
        'div',
        {},
        el('div', { style: 'font-size:15px;font-weight:600;' }, 'What left your machine'),
        el(
          'div',
          { class: 'muted', style: 'font-size:12px;margin-top:2px;' },
          'Click any placeholder to put the real value back.',
        ),
      ),
      close,
    ),
    el(
      'div',
      { style: 'flex:1;display:flex;gap:14px;min-height:0;' },
      column('You typed', renderOriginal(opts.original, opts.placeholders)),
      column('We sent', renderRedacted(opts.redacted, opts.placeholders, opts.onRevert)),
    ),
  );

  getLayer().append(card);
  current = card;
}

export function closeDiff(): void {
  current?.remove();
  current = null;
}
