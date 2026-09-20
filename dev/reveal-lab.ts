/**
 * Reveal lab: a fake thread with everything that breaks the overlays in situ
 * and nothing that does not -- the same message present twice (once clipped
 * for screen readers), a reply that streams in and moves the thread under the
 * revealed values, and a composer pinned to the bottom that our panels have
 * to stay off.
 */
import { startRehydration, setRevealAll, setWrappedCountHandler } from '../src/content/rehydrate';
import { showRevealToggle, setRevealHandler, showPending } from '../src/content/ui/reveal';
import { setOverlayAnchor, setOverlayTheme } from '../src/content/ui/shell';
import { showToast } from '../src/content/ui/toast';
import { renderLive } from '../src/content/ui/live';
import { markSettled } from '../src/worker/incremental';
import { scan } from '../src/worker/detectors';
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

const composer = document.getElementById('composer') as HTMLElement;
const params = new URLSearchParams(location.search);
if (params.has('sidebar')) document.body.classList.add('with-sidebar');
let dark = params.get('theme') === 'dark';
setOverlayTheme(dark ? 'dark' : 'light');
document.getElementById('toggle-theme')?.addEventListener('click', () => {
  dark = !dark;
  setOverlayTheme(dark ? 'dark' : 'light');
});
document
  .getElementById('toggle-sidebar')
  ?.addEventListener('click', () => document.body.classList.toggle('with-sidebar'));
setOverlayAnchor(() => composer);

const SCAN = 'Call me on 540-555-0142 or dana@example.org';
const actions: Record<string, () => void> = {
  toast: () =>
    showToast({
      placeholders,
      onUndo: () => console.info('undo'),
      onOpenDiff: () => console.info('diff'),
    }),
  pending: () => showPending('Checking before this goes out…'),
  live: () => {
    const findings = scan(SCAN).findings;
    renderLive(markSettled(findings, SCAN, null), { chunks: 1, hits: 1, misses: 0, elapsedMs: 0.4 }, SCAN.length);
  },
};
for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-show]')) {
  btn.addEventListener('click', () => actions[btn.dataset.show ?? '']?.());
}

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
