/**
 * @vitest-environment happy-dom
 *
 * Runs the real popup and dashboard entry points against a fake `chrome` API.
 * This checks the logic and the DOM they produce, not the visual design -- for
 * that, load the built extension and look at it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings, UsageEvent } from '../src/shared/types';

const DAY = 24 * 60 * 60 * 1000;

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
  timestamp: Date.now(),
  host: 'claude.ai',
  lane: 'frontier',
  blocked: false,
  redactions: {},
  promptTokens: 100,
  scanMs: 1,
  ...over,
});

interface Fake {
  sent: Array<{ type: string; patch?: Partial<Settings> }>;
  settings: Settings;
}

function installChrome(opts: { url?: string; events: UsageEvent[]; enabled?: boolean }): Fake {
  const fake: Fake = {
    sent: [],
    settings: {
      mode: 'autopilot',
      enabled: opts.enabled ?? true,
      nerEnabled: false,
      autoRedactNames: false,
      nerAutoRedactMinScore: 0.7,
      policy: null,
    },
  };
  const chromeStub = {
    runtime: {
      sendMessage: async (msg: { type: string; patch?: Partial<Settings> }) => {
        fake.sent.push(msg);
        if (msg.type === 'settings:get') return { type: 'settings:value', settings: fake.settings };
        if (msg.type === 'settings:set') {
          fake.settings = { ...fake.settings, ...msg.patch };
          return { type: 'settings:value', settings: fake.settings };
        }
        if (msg.type === 'usage:query') return { type: 'usage:rows', events: opts.events };
        if (msg.type === 'ner:probe') {
          return {
            type: 'ner:probe-result',
            probe: { wasm: false, webgpu: false, crossOriginIsolated: false, deviceMemoryGb: null, error: null },
            loaded: false,
            error: null,
          };
        }
        return { type: 'ok' };
      },
      getManifest: () => ({ options_page: 'src/options/index.html' }),
      getURL: (p: string) => `chrome-extension://abc/${p}`,
      openOptionsPage: vi.fn(),
    },
    tabs: {
      query: async () => (opts.url ? [{ url: opts.url }] : [{}]),
      create: vi.fn(),
    },
    storage: { onChanged: { addListener: vi.fn() } },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
  return fake;
}

const text = (): string => document.body.textContent ?? '';

// Each test re-imports the entry points, and the window outlives the import.
// Without this, an earlier test's `hashchange` listener fires during a later
// test (or after the fake chrome is gone) and throws. Track and remove them.
type Registered = [string, EventListenerOrEventListenerObject];
const registered: Registered[] = [];
const realAddEventListener = window.addEventListener.bind(window);

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    registered.push([type, listener]);
    realAddEventListener(type, listener, options as AddEventListenerOptions);
  }) as typeof window.addEventListener;
  location.hash = '';
});

afterEach(() => {
  for (const [type, listener] of registered) window.removeEventListener(type, listener);
  registered.length = 0;
  window.addEventListener = realAddEventListener as typeof window.addEventListener;
  delete (globalThis as { chrome?: unknown }).chrome;
});

// A mix that exercises every window: today, this week, this month, older.
const EVENTS: UsageEvent[] = [
  ev({ timestamp: Date.now() - 40 * DAY, redactions: { email: 1 } }), // outside 30 days
  ev({ timestamp: Date.now() - 3 * DAY, redactions: { phone: 1 } }),
  ev({ timestamp: Date.now() - 2 * DAY }), // a prompt with nothing to redact
  ev({ timestamp: Date.now() - 1000, redactions: { email: 2, api_key: 1 } }),
];

describe('popup', () => {
  async function open(): Promise<void> {
    document.body.innerHTML = '<div id="app" class="popup"></div>';
    await import('../src/popup/main');
    await vi.waitFor(() => expect(document.querySelector('.hero')).not.toBeNull());
  }

  it('shows the counts, categories and tokens saved on a supported site', async () => {
    installChrome({ url: 'https://claude.ai/chat/1', events: EVENTS });
    await open();

    const t = text();
    expect(t).toContain('claude.ai');
    expect(t).toContain('Protection is on');
    // Today: 2 emails + 1 key. Seven days adds the phone from 3 days ago.
    expect(document.querySelector('.stats')?.textContent).toContain('Redacted today3');
    expect(document.querySelector('.stats')?.textContent).toContain('Redacted in 7 days4');
    // Categories today, plain language, largest first.
    const chips = [...document.querySelectorAll('.chip')].map((c) => c.textContent?.trim());
    expect(chips).toEqual(['Emails 2', 'API keys 1']);
    // Never a raw enum value.
    expect(t).not.toContain('api_key');
  });

  it('caps the category chips so the popup stays under the 600px limit', async () => {
    // Six kinds today: four chips, then "+2 more".
    installChrome({
      url: 'https://claude.ai/',
      events: [
        ev({
          redactions: { api_key: 6, email: 5, phone: 4, credit_card: 3, street_address: 2, ssn: 1 },
        }),
      ],
    });
    await open();
    const chips = [...document.querySelectorAll('.chip')].map((c) => c.textContent?.trim());
    expect(chips).toHaveLength(5);
    expect(chips[4]).toBe('+2 more');
  });

  it('has no tokens anywhere in the popup', async () => {
    installChrome({ url: 'https://claude.ai/', events: EVENTS });
    await open();
    expect(text().toLowerCase()).not.toContain('token');
    expect(document.querySelector('.tokens, .split')).toBeNull();
  });

  it('has an honest first-run state', async () => {
    installChrome({ url: 'https://claude.ai/', events: [] });
    await open();
    expect(text()).toContain('Anything Prompt Firewall redacts shows up here.');
  });

  it('shows the blocked state after a recent blocked send', async () => {
    installChrome({ url: 'https://claude.ai/', events: [ev({ blocked: true })] });
    await open();
    expect(text()).toContain('Last send was blocked');
    expect(text()).toContain('there is no override');
    expect(document.querySelector('.hazard')).not.toBeNull();
  });

  it('is inactive, with no controls that do nothing, on an unsupported site', async () => {
    installChrome({ url: 'https://example.com/', events: EVENTS });
    await open();
    expect(text()).toContain('Not active on this site');
    expect(text()).toContain('Supported');
    expect(document.querySelector('.modes')).toBeNull();
    expect(document.querySelector('.stats')).toBeNull();
    expect(document.querySelector('.lock-btn')?.getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('.lock-btn')?.classList.contains('asleep')).toBe(true);
  });

  it('treats a tab the browser will not name as unsupported rather than guessing', async () => {
    installChrome({ events: EVENTS });
    await open();
    expect(text()).toContain('Not active on this site');
  });

  it('shows the lock dancing while protection is on', async () => {
    installChrome({ url: 'https://claude.ai/', events: [] });
    await open();
    const btn = document.querySelector('.lock-btn');
    expect(btn?.classList.contains('dancing')).toBe(true);
    expect(btn?.querySelector('img.lock')).not.toBeNull();
    // Motion is never the only signal: the state is also written out.
    expect(text()).toContain('Protection is on');
  });

  it('holds the lock still and grey when paused', async () => {
    installChrome({ url: 'https://claude.ai/', events: [], enabled: false });
    await open();
    const btn = document.querySelector('.lock-btn');
    expect(btn?.classList.contains('paused')).toBe(true);
    expect(btn?.classList.contains('dancing')).toBe(false);
    expect(text()).toContain('Protection is paused');
  });

  it('shakes its head, once, after a blocked send', async () => {
    installChrome({ url: 'https://claude.ai/', events: [ev({ blocked: true })] });
    await open();
    expect(document.querySelector('.lock-btn')?.classList.contains('blocked')).toBe(true);
  });

  it('the lock switch writes the enabled setting and reflects it', async () => {
    const fake = installChrome({ url: 'https://claude.ai/', events: [] });
    await open();
    const power = document.querySelector<HTMLButtonElement>('.lock-btn');
    expect(power?.getAttribute('aria-checked')).toBe('true');

    power?.click();
    await vi.waitFor(() =>
      expect(fake.sent.some((m) => m.type === 'settings:set' && m.patch?.enabled === false)).toBe(true),
    );
    await vi.waitFor(() => expect(text()).toContain('Protection is paused'));
    expect(document.querySelector('.lock-btn')?.getAttribute('aria-checked')).toBe('false');
  });

  it('a mode button writes the mode setting', async () => {
    const fake = installChrome({ url: 'https://claude.ai/', events: [] });
    await open();
    const watch = [...document.querySelectorAll<HTMLButtonElement>('.modes button')].find((b) => b.textContent === 'Watch');
    watch?.click();
    await vi.waitFor(() => expect(fake.sent.some((m) => m.type === 'settings:set' && m.patch?.mode === 'watch')).toBe(true));
    await vi.waitFor(() => expect(text()).toContain('Never changes your text'));
  });

  it("does not promise strict mode's confirmation step, which is not wired yet", async () => {
    installChrome({ url: 'https://claude.ai/', events: [] });
    await open();
    const strict = [...document.querySelectorAll<HTMLButtonElement>('.modes button')].find((b) => b.textContent === 'Strict');
    strict?.click();
    await vi.waitFor(() => expect(text()).toContain('Works like Autopilot for now'));
  });
});

describe('dashboard', () => {
  async function open(hash = ''): Promise<void> {
    location.hash = hash;
    document.body.innerHTML = '<div id="app"></div>';
    await import('../src/options/main');
    await vi.waitFor(() => expect(document.querySelector('.topbar')).not.toBeNull());
  }

  it('has exactly two tabs: Overview and Settings', async () => {
    installChrome({ events: EVENTS });
    await open();
    const tabs = [...document.querySelectorAll('.tab')].map((t) => t.textContent);
    expect(tabs).toEqual(['Overview', 'Settings']);
    expect(document.querySelector('.tab[aria-current="page"]')?.textContent).toBe('Overview');
  });

  it('shows items redacted and prompts checked for all time, 7 days and 30 days', async () => {
    installChrome({ events: EVENTS });
    await open();
    await vi.waitFor(() => expect(document.querySelectorAll('.ticket')).toHaveLength(3));

    const read = (i: number): { name: string; items: string; prompts: string } => {
      const t = document.querySelectorAll('.ticket')[i];
      return {
        name: t?.querySelector('.ticket-name')?.textContent ?? '',
        items: t?.querySelector('.num.chip')?.textContent ?? '',
        prompts: t?.querySelectorAll('.num')[1]?.textContent ?? '',
      };
    };
    // All time: 1 + 1 + 3 = 5 items over 4 prompts. 7 days and 30 days drop the 40-day-old row.
    expect(read(0)).toEqual({ name: 'All time', items: '5', prompts: '4' });
    expect(read(1)).toEqual({ name: '7 days', items: '4', prompts: '3' });
    expect(read(2)).toEqual({ name: '30 days', items: '4', prompts: '3' });
  });

  it('has no tokens section', async () => {
    installChrome({ events: EVENTS });
    await open();
    await vi.waitFor(() => expect(document.querySelectorAll('.ticket')).toHaveLength(3));
    expect(text().toLowerCase()).not.toContain('token');
    expect(document.querySelector('.strip')).toBeNull();
  });

  it('uses the lock as its logo and in the hero', async () => {
    installChrome({ events: EVENTS });
    await open();
    await vi.waitFor(() => expect(document.querySelector('.hero-lock')).not.toBeNull());
    expect(document.querySelector('.brand img')).not.toBeNull();
    expect(document.querySelector('.brand svg')).toBeNull(); // the old shield is gone
  });

  it('renders storage-derived text as text, never as markup', async () => {
    // A hostile error string from the background must not become DOM.
    const fake = installChrome({ events: [] });
    const original = (globalThis as unknown as { chrome: { runtime: { sendMessage: (m: { type: string }) => Promise<unknown> } } }).chrome;
    const send = original.runtime.sendMessage;
    original.runtime.sendMessage = async (m) =>
      m.type === 'ner:probe'
        ? {
            type: 'ner:probe-result',
            probe: { wasm: true, webgpu: false, crossOriginIsolated: false, deviceMemoryGb: 8, error: null },
            loaded: false,
            error: '<img src=x onerror=alert(1)>',
          }
        : send(m);
    void fake;
    await open('#settings');
    await vi.waitFor(() => expect(text()).toContain('<img src=x onerror=alert(1)>'));
    // The page has its own lock images now, so look for the injected one specifically.
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('settings switches write through to the setting', async () => {
    const fake = installChrome({ events: [] });
    await open('#settings');
    await vi.waitFor(() => expect(document.querySelector('[data-setting="enabled"]')).not.toBeNull());
    const box = document.querySelector<HTMLInputElement>('[data-setting="enabled"]');
    expect(box?.checked).toBe(true);
    if (box) {
      box.checked = false;
      box.dispatchEvent(new Event('change'));
    }
    await vi.waitFor(() =>
      expect(fake.sent.some((m) => m.type === 'settings:set' && m.patch?.enabled === false)).toBe(true),
    );
  });
});
