/**
 * Failure surfaces.
 *
 * Both of these report that the extension did not do what it claimed. They
 * are deliberately loud and deliberately not auto-dismissing: a silent
 * failure here means the user believes their data was scrubbed when it was
 * not, and that belief is more dangerous than no extension at all.
 */
import type { Placeholder } from '../../shared/types';
import { el, getLayer } from './shell';

let current: HTMLElement | null = null;

function panel(title: string, body: (HTMLElement | string)[], accent: string): void {
  current?.remove();
  const close = el('button', { class: 'pf' }, 'Dismiss');
  const card = el(
    'div',
    {
      class: 'card',
      style:
        `position:absolute;left:50%;top:32px;transform:translateX(-50%);width:min(520px,92vw);` +
        `padding:18px;display:flex;flex-direction:column;gap:12px;border-color:${accent};`,
    },
    el('div', { style: `font-size:15px;font-weight:600;color:${accent};` }, title),
    ...body,
    el('div', { style: 'display:flex;justify-content:flex-end;' }, close),
  );
  close.addEventListener('click', () => {
    card.remove();
    current = null;
  });
  getLayer().append(card);
  current = card;
}

/** The composer would not accept our text, so we refused to send. */
export function showWriteFailure(): void {
  panel(
    'Message not sent',
    [
      el(
        'div',
        { style: 'font-size:13.5px;line-height:1.55;' },
        'Sensitive content was found, but the redacted text could not be written into the ' +
          'composer. Rather than send your original text, the message was held.',
      ),
      el(
        'div',
        { class: 'muted', style: 'font-size:12.5px;line-height:1.55;' },
        'Your text is untouched in the box. Edit the sensitive parts yourself and send again, ' +
          'or reload the page.',
      ),
    ],
    '#ffa62b',
  );
}

/** The audit found a value on the page that we believed we had replaced. */
export function showLeakWarning(leaked: Placeholder[]): void {
  panel(
    'Redaction may have failed',
    [
      el(
        'div',
        { style: 'font-size:13.5px;line-height:1.55;' },
        `After sending, ${leaked.length} value${leaked.length > 1 ? 's were' : ' was'} still ` +
          'visible on this page that should have been replaced. Treat this message as if the ' +
          'data was sent.',
      ),
      el(
        'ul',
        { style: 'margin:0;padding-left:18px;font-size:12.5px;' },
        ...leaked.map((p) => el('li', {}, `${p.token} (${p.kind})`)),
      ),
      el(
        'div',
        { class: 'muted', style: 'font-size:12.5px;line-height:1.55;' },
        'Delete the message in the chat, and rotate any credential involved.',
      ),
    ],
    '#ff5d5d',
  );
}
