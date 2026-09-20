/**
 * Dashboard: two tabs, Overview and Settings.
 *
 * Overview answers "what did it do for me" in a few numbers, per time period.
 * Everything is computed from the local usage log, which holds counts and
 * labels only. Nothing here can show a prompt or a detected value, because
 * neither exists to be read.
 *
 * Settings holds the switches and the local-AI panel.
 */
import '../shared/fonts';
import '../shared/theme.css';
import './options.css';
import { applyTheme } from '../shared/apply-theme';
import { h } from '../shared/dom';
import type { Child } from '../shared/dom';
import { arrow, lock } from '../shared/icons';
import { sendToBackground } from '../shared/messages';
import type { Probe } from '../shared/ner';
import { ALL_TIME_MS, formatCount, lastDays, rangeStart, shortDate, summarize } from '../shared/stats';
import type { Summary } from '../shared/stats';
import type { Settings } from '../shared/types';
import { receiptSection } from './receipt-export';
import { policySection } from './policy-section';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const app: HTMLElement = root;

type View = 'overview' | 'settings';
const currentView = (): View => (location.hash === '#settings' ? 'settings' : 'overview');

// ---------------------------------------------------------------------------
// chrome
// ---------------------------------------------------------------------------

function topbar(view: View): HTMLElement {
  const tab = (id: View, label: string): HTMLElement =>
    h('a', { class: 'tab', href: `#${id}`, 'aria-current': view === id ? 'page' : undefined }, label);
  return h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, lock(30), h('span', {}, 'Deadbolt')),
    h('nav', { class: 'tabs', 'aria-label': 'Sections' }, tab('overview', 'Overview'), tab('settings', 'Settings')),
  );
}

// ---------------------------------------------------------------------------
// overview
// ---------------------------------------------------------------------------

interface Period {
  name: string;
  range: string;
  s: Summary;
}

const numChip = (v: string): HTMLElement => h('span', { class: 'num chip' }, v);

function ticket(p: Period): HTMLElement {
  return h(
    'article',
    { class: 'ticket' },
    h('div', { class: 'ticket-head' }, h('div', { class: 'ticket-name' }, p.name), h('div', { class: 'ticket-range' }, p.range)),
    h('div', { class: 'perf', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'ticket-body' },
      h('div', {}, h('div', { class: 'label' }, 'Items redacted'), numChip(formatCount(p.s.items))),
      h('div', {}, h('div', { class: 'label' }, 'Prompts checked'), h('span', { class: 'num' }, formatCount(p.s.prompts))),
    ),
  );
}

async function overview(): Promise<HTMLElement> {
  const { events } = await sendToBackground({ type: 'usage:query', sinceMs: ALL_TIME_MS });
  const now = Date.now();
  const first = events[0]?.timestamp;
  const span = (days: number): string => `${shortDate(rangeStart(days, now))} to ${shortDate(now)}`;

  const periods: Period[] = [
    { name: 'All time', range: first ? `Since ${shortDate(first)}` : 'No activity yet', s: summarize(events) },
    { name: '7 days', range: span(7), s: summarize(lastDays(events, 7, now)) },
    { name: '30 days', range: span(30), s: summarize(lastDays(events, 30, now)) },
  ];

  return h(
    'div',
    {},
    h(
      'section',
      { class: 'hero' },
      lock(120, { large: true, className: 'hero-lock' }),
      h(
        'div',
        {},
        h('h1', {}, "Here's what ", h('span', { class: 'hl' }, 'stayed private.')),
        h('p', {}, 'Deadbolt counted everything on your device. It never stored what you typed.'),
      ),
      h('div', { class: 'aside-note' }, arrow(), h('span', {}, 'counted right here,', h('br'), 'not on our servers')),
    ),
    h(
      'section',
      { class: 'block' },
      h('h2', {}, 'Kept out of your prompts'),
      h('p', { class: 'sub' }, 'Personal details replaced before a prompt was sent, and how many prompts were checked.'),
      h('div', { class: 'tickets' }, ...periods.map(ticket)),
    ),
    receiptSection(events),
  );
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

type BooleanSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function toggle(settings: Settings, key: BooleanSetting, label: string, note: string): HTMLElement {
  const box = h('input', { type: 'checkbox', role: 'switch', class: 'switch', 'data-setting': key });
  box.checked = settings[key];
  box.addEventListener('change', () => {
    void sendToBackground({ type: 'settings:set', patch: { [key]: box.checked } });
  });
  return h(
    'label',
    { class: 'setting' },
    h('span', { class: 'setting-text' }, h('span', { class: 'setting-name' }, label), h('span', { class: 'setting-note' }, note)),
    box,
  );
}

const kv = (k: string, v: string): HTMLElement => h('div', { class: 'kv' }, h('span', {}, k), h('strong', {}, v));

/**
 * Local AI panel.
 *
 * Probes capability BEFORE offering the download, so a machine that cannot
 * compile WASM says so in milliseconds instead of after fetching 183 MB.
 * Error strings come from the background and are rendered as text, never HTML.
 */
async function fillNer(host: HTMLElement): Promise<void> {
  let probe: Probe;
  let loaded = false;
  let error: string | null = null;
  try {
    const res = await sendToBackground({ type: 'ner:probe' });
    probe = res.probe;
    loaded = res.loaded;
    error = res.error;
  } catch (err) {
    // Most likely the offscreen document failed to be created at all. Say
    // so, rather than leaving the panel stuck on "Checking this machine".
    host.replaceChildren(
      h('p', { class: 'note err' }, 'Could not reach the detection host.'),
      h('p', { class: 'note' }, String(err)),
      h(
        'p',
        { class: 'note' },
        'Check chrome://extensions, then Deadbolt, then "Inspect views: offscreen" for the underlying error. Pattern detection is unaffected.',
      ),
    );
    return;
  }

  const backend = probe.webgpu ? 'WebGPU' : probe.wasm ? 'WebAssembly (CPU)' : 'unavailable';
  const rows: Child[] = [
    kv('WebAssembly', probe.wasm ? 'available' : 'BLOCKED'),
    kv('WebGPU', probe.webgpu ? 'available' : 'not available'),
    kv('Backend that would be used', backend),
    kv('Reported device memory', probe.deviceMemoryGb ? `${probe.deviceMemoryGb} GB` : 'unknown'),
    kv('Model', loaded ? 'loaded' : 'not loaded'),
    error ? h('p', { class: 'note err' }, error) : null,
  ];

  if (!probe.wasm) {
    host.replaceChildren(
      ...(rows.filter(Boolean) as Node[]),
      h(
        'p',
        { class: 'note' },
        'WebAssembly could not be compiled here, so local AI detection cannot run. Pattern detection is unaffected and keeps working.',
      ),
    );
    return;
  }

  const status = h('span', { class: 'status-line' });
  const load = h('button', { type: 'button', class: 'btn' }, loaded ? 'Reload model' : 'Download and enable (~183 MB, once)');
  const test = h('button', { type: 'button', class: 'btn ghost' }, 'Run self-test');

  load.addEventListener('click', () => {
    load.disabled = true;
    status.textContent = 'Downloading… this takes a minute on first run.';
    void (async () => {
      const r = await sendToBackground({ type: 'ner:load' });
      if (r.ok) {
        await sendToBackground({ type: 'settings:set', patch: { nerEnabled: true } });
        status.textContent = 'Ready. Highlights will appear as you type.';
      } else {
        status.textContent = `Failed: ${r.error ?? 'unknown'}`;
        load.disabled = false;
      }
    })();
  });

  test.addEventListener('click', () => {
    test.disabled = true;
    status.textContent = 'Running one inference…';
    void (async () => {
      const r = await sendToBackground({ type: 'ner:selftest' });
      test.disabled = false;
      if (r.error) {
        status.textContent = `Failed: ${r.error}`;
        return;
      }
      const found = r.spans.map((s) => `${s.text} (${s.label} ${Math.round(s.score * 100)}%)`);
      status.textContent = `${r.ms.toFixed(0)} ms on ${r.provider}: ${found.length ? found.join(', ') : 'no entities found'}`;
    })();
  });

  host.replaceChildren(...(rows.filter(Boolean) as Node[]), h('div', { class: 'actions-row' }, load, test, status));
}

async function settingsView(): Promise<HTMLElement> {
  const { settings } = await sendToBackground({ type: 'settings:get' });

  const ner = h('div', {}, h('p', { class: 'note' }, 'Checking this machine…'));
  // Not awaited: the panel fills in when the probe returns, and nothing else
  // on the page should wait for it.
  void fillNer(ner);

  return h(
    'div',
    {},
    h('h1', { class: 'page-title' }, 'Settings'),
    h('p', { class: 'note' }, 'Everything on this page was computed on this machine. No account, no server, no sync.'),
    h(
      'section',
      { class: 'block' },
      h('h2', {}, 'Protection'),
      h('p', { class: 'sub' }, 'What Deadbolt does while you use a chat site.'),
      h(
        'div',
        { class: 'card' },
        toggle(settings, 'enabled', 'Enabled', 'Master switch.'),
      ),
    ),
    h(
      'section',
      { class: 'block' },
      h('h2', {}, 'Local AI detection'),
      h(
        'p',
        { class: 'sub' },
        'A model that finds names, organizations and other free-text details regex cannot. It runs entirely on this machine. Enabling it downloads the model once.',
      ),
      h(
        'div',
        { class: 'card' },
        toggle(
          settings,
          'nerEnabled',
          'Local AI detection',
          'Highlight names and organizations using the local model. Requires the download below.',
        ),
        toggle(
          settings,
          'autoRedactNames',
          'Replace names without confirming',
          'Off by default: names found by the model are highlighted, and you click one to mark it for replacement. Turning this on replaces any name the model is confident about without asking. Fewer clicks, but the model will occasionally be wrong.',
        ),
      ),
      h('div', { class: 'card', style: 'margin-top:16px' }, ner),
    ),
    policySection(settings),
  );
}

// ---------------------------------------------------------------------------
// routing and boot
// ---------------------------------------------------------------------------

let renderId = 0;

async function renderView(): Promise<void> {
  const id = ++renderId;
  const view = currentView();
  // The theme is chosen in the popup and applies to every surface, so pick it
  // up here too rather than making the dashboard a second place to set it.
  void sendToBackground({ type: 'settings:get' }).then((r) => applyTheme(r.settings.theme));
  const content = view === 'settings' ? await settingsView() : await overview();
  // A newer navigation started while this one was loading: drop this result.
  if (id !== renderId) return;

  document.title = `${view === 'settings' ? 'Settings' : 'Overview'} · Deadbolt`;
  const parts: Node[] = [topbar(view), h('main', { class: 'view' }, content)];
  if (view === 'overview') {
    parts.push(
      h('p', { class: 'footnote' }, 'Only counts are kept. Prompt text and detected values are never stored.'),
    );
  }
  app.replaceChildren(...parts);
}

window.addEventListener('hashchange', () => void renderView());

// New activity while the dashboard is open. Settings is left alone, so a
// switch the user just flipped is not redrawn underneath them.
let refreshTimer: number | undefined;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // The theme follows even on Settings, where nothing else is redrawn.
  const next = changes['settings_v1']?.newValue as Settings | undefined;
  if (next?.theme) applyTheme(next.theme);
  if (currentView() !== 'overview') return;
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void renderView(), 250);
});

void renderView();
