/**
 * Preview the popup and the dashboard in a normal browser tab.
 *
 *   preview.html?page=popup
 *   preview.html?page=popup&site=other        unsupported site
 *   preview.html?page=popup&enabled=0         paused
 *   preview.html?page=popup&blocked=1         a send was just blocked
 *   preview.html?page=popup&empty=1           first run, no activity yet
 *   preview.html?page=popup&theme=dark        dark mode
 *   preview.html?page=dashboard
 *   preview.html?page=settings
 *
 * The data is invented. It exists so the layout can be judged.
 */
import { installFakeChrome } from './fake-chrome';
import type { UsageEvent } from '../src/shared/types';

const q = new URLSearchParams(location.search);
const page = q.get('page') ?? 'popup';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const row = (over: Partial<UsageEvent>): UsageEvent => ({
  timestamp: now,
  host: 'claude.ai',
  lane: 'frontier',
  blocked: false,
  redactions: {},
  promptTokens: 120,
  scanMs: 0.6,
  ...over,
});

/** A believable spread: today, this week, this month, and older. */
function sample(): UsageEvent[] {
  const events: UsageEvent[] = [];
  // Older than 30 days.
  for (let i = 0; i < 40; i++) {
    events.push(row({ timestamp: now - (31 + i) * DAY, redactions: i % 3 === 0 ? { email: 2, phone: 1 } : {} }));
  }
  // The last 30 days.
  for (let d = 29; d >= 1; d--) {
    for (let k = 0; k < 1 + (d % 4); k++) {
      const redactions =
        (d + k) % 3 === 0
          ? { email: 1 + (k % 2), api_key: 1 }
          : (d + k) % 3 === 1
            ? { phone: 1, credit_card: d % 5 === 0 ? 1 : 0 }
            : {};
      events.push(row({ timestamp: now - d * DAY - k * 3_600_000, redactions }));
    }
  }
  // Today.
  events.push(row({ timestamp: now - 3 * 3_600_000, redactions: { email: 2 } }));
  events.push(row({ timestamp: now - 2 * 3_600_000, redactions: { api_key: 3, credit_card: 1 } }));
  events.push(row({ timestamp: now - 3_600_000, redactions: { phone: 1, street_address: 1 } }));
  return events;
}

let events = q.get('empty') ? [] : sample();
if (q.get('blocked')) events = [...events, row({ timestamp: now - 60_000, blocked: true })];

installFakeChrome({
  url: q.get('site') === 'other' ? 'https://example.com/docs' : 'https://claude.ai/chat/abc',
  enabled: q.get('enabled') !== '0',
  theme: q.get('theme') === 'dark' ? 'dark' : 'light',
  events,
});

if (page === 'popup') {
  document.getElementById('app')?.classList.add('popup');
  await import('../src/popup/main');
} else {
  if (page === 'settings') location.hash = '#settings';
  await import('../src/options/main');
}
