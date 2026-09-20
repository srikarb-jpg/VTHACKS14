/**
 * Failure surface.
 *
 * This reports that the extension did not do what it claimed. It is
 * deliberately loud and deliberately not auto-dismissing: a silent failure
 * here means the user believes their data was scrubbed when it was not, and
 * that belief is more dangerous than no extension at all.
 */
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

/*
 * The leak warning panel used to live here.
 *
 * Removed at the user's request: it was interrupting the page on a send that
 * had worked, because the value it found was already in the conversation from
 * an earlier turn. The audit itself still runs on every redacted send and
 * still reports a genuine leak, now only to the console --
 * `[deadbolt] AUDIT FAILED`. If this comes back, it should come back
 * with the before/after comparison in src/worker/audit.ts behind it.
 */
