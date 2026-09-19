/**
 * Reveal lab: a fake thread that reproduces what breaks hover rehydration in
 * situ -- the same message present twice (once clipped for screen readers),
 * and a response that streams in and moves every message while the values are
 * on screen.
 */
import { startRehydration, setRevealAll, setWrappedCountHandler } from '../src/content/rehydrate';
import { showRevealToggle, setRevealHandler } from '../src/content/ui/reveal';
import type { Placeholder } from '../src/shared/types';
import type { ComposerAdapter } from '../src/content/adapters/types';

const placeholders: Placeholder[] = [
  { token: 'SSN_1', kind: 'ssn', value: '423-12-1234' },
  { token: 'EMAIL_1', kind: 'email', value: 'dana.whitfield@northlake-health.org' },
];

const thread = document.getElementById('thread') as HTMLElement;

function msg(cls: string, html: string): HTMLElement {
  const d = document.createElement('div');
  d.className = `msg ${cls}`;
  d.textContent = html;
  thread.append(d);
  return d;
}

msg('assistant', 'What can I help you with?');
const sr = document.createElement('div');
sr.className = 'sr';
sr.textContent = 'My SSN is [SSN_1] and my email is [EMAIL_1]';
thread.append(sr);
msg('user', 'My SSN is [SSN_1] and my email is [EMAIL_1]');
const reply = msg('assistant', '');

setRevealHandler((on) => setRevealAll(on));
setWrappedCountHandler((n) => showRevealToggle(n));
startRehydration({ getComposer: () => null } as unknown as ComposerAdapter, () =>
  Promise.resolve(placeholders),
);

// Stream a reply that mentions both tokens, so everything above it keeps moving.
const WORDS =
  'That one came through as just a placeholder, [SSN_1] , so there is no number in it. ' +
  'I also see [EMAIL_1] in your message. Either way, I cannot do anything with an SSN in chat, ' +
  'and I will not store or reuse one. If you are filling out a form or verifying your identity, ' +
  'tell me what it is and I will help with the parts I can.'
;
const parts = WORDS.split(' ');
let i = 0;
const tick = (): void => {
  if (i >= parts.length) return;
  reply.textContent = parts.slice(0, ++i).join(' ');
  window.setTimeout(tick, 90);
};
window.setTimeout(tick, 600);
