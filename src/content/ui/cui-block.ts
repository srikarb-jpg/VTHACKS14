/**
 * The classification hard stop. The ONLY thing in this product that prevents
 * a send.
 *
 * Everything else in Prompt Firewall is advisory by design -- the user always
 * gets to send what they want. Marked content is the deliberate exception,
 * and it is exceptional for a reason worth stating on screen: a CUI or
 * export-controlled marking is a legal control on the document as a whole,
 * not a sensitive substring we can swap out. Redacting the marking and
 * sending the body would be strictly worse than either blocking or sending,
 * because it would strip the very label that says the body is controlled.
 *
 * There is no override button. That is the point.
 */
import type { BlockPanelOptions } from '../../shared/messages';
import { el, getLayer } from './shell';

let current: HTMLElement | null = null;

export function showBlockPanel(opts: BlockPanelOptions): void {
  closeBlockPanel();

  const dismiss = el('button', { class: 'pf danger' }, 'Back to my prompt');
  dismiss.addEventListener('click', () => {
    opts.onDismiss();
    closeBlockPanel();
  });

  const list = el('ul', { style: 'margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;' });
  for (const f of opts.findings) {
    list.append(
      el(
        'li',
        { style: 'font-size:13px;line-height:1.5;' },
        el('span', { class: 'mono tok' }, f.value),
        ' ',
        el('span', { class: 'muted' }, `— ${f.label}`),
      ),
    );
  }

  const card = el(
    'div',
    {
      class: 'card',
      style:
        'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);padding:22px;display:flex;flex-direction:column;gap:14px;border-color:#a33636;',
    },
    el(
      'div',
      { style: 'display:flex;align-items:center;gap:10px;' },
      el(
        'span',
        {
          style:
            'display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:#8f2d2d;color:#fff;font-weight:700;font-size:15px;',
        },
        '!',
      ),
      el('div', { style: 'font-size:16px;font-weight:600;' }, 'Send blocked'),
    ),
    el(
      'div',
      { style: 'font-size:13.5px;line-height:1.55;' },
      'This prompt carries a classification or control marking. It was not sent, and nothing left this machine.',
    ),
    list,
    el(
      'div',
      { class: 'muted', style: 'font-size:12.5px;line-height:1.55;border-top:1px solid #2c3039;padding-top:12px;' },
      'Marked material is controlled as a whole document, so there is no substring we could redact to make it safe. Prompt Firewall does not offer an override for this one case.',
    ),
    el('div', { style: 'display:flex;justify-content:flex-end;' }, dismiss),
  );

  getLayer().append(card);
  current = card;
}

export function closeBlockPanel(): void {
  current?.remove();
  current = null;
}
