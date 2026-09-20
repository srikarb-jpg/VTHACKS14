/**
 * Toolbar popup.
 *
 * Answers three questions without asking for anything: is it on here, what did
 * it catch, and what can I change fast. Everything else lives on the dashboard.
 *
 * Reads the same local usage log as the dashboard and computes from counts
 * only. No prompt text or detected value exists in that log, so none can be
 * shown here.
 */
import '../shared/fonts';
import '../shared/theme.css';
import './popup.css';
import { SUPPORTED_HOSTS } from '../shared/config';
import { applyTheme, nextTheme } from '../shared/apply-theme';
import { h } from '../shared/dom';
import type { Child } from '../shared/dom';
import { icons, lock } from '../shared/icons';
import { sendToBackground } from '../shared/messages';
import { ALL_TIME_MS, KIND_INFO, lastDays, summarize, today } from '../shared/stats';
import type { Tier } from '../shared/stats';
import type { Mode, Settings, UsageEvent } from '../shared/types';

interface State {
  settings: Settings;
  events: UsageEvent[];
  /** Hostname of the active tab, or null when the browser will not say. */
  host: string | null;
  supported: boolean;
}

const MODE_COPY: Record<Mode, { label: string; note: string }> = {
  watch: { label: 'Watch mode', note: 'Logs what it finds. Never changes your text.' },
  autopilot: { label: 'Autopilot mode', note: 'Redacts keys, cards and emails before sending.' },
  // Strict is offered in the design but the confirmation step is not wired
  // yet (see README). Say so instead of promising it.
  strict: { label: 'Strict mode', note: 'Confirmation before sending is coming. Works like Autopilot for now.' },
};

/** Most category chips shown before the rest collapse into "+N more". */
const MAX_CHIPS = 4;

/** A block shows the "last send was blocked" state for this long. */
const BLOCKED_NOTICE_MS = 30 * 60 * 1000;

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const app: HTMLElement = root;

let state: State | null = null;

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

async function activeSite(): Promise<Pick<State, 'host' | 'supported'>> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host: string | null = null;
  try {
    // tab.url is only populated for hosts we hold permission for, which are
    // exactly the supported ones. Anything else comes back undefined.
    if (tab?.url) host = new URL(tab.url).hostname;
  } catch {
    host = null;
  }
  const supported = host !== null && SUPPORTED_HOSTS.some((s) => host === s || host?.endsWith(`.${s}`));
  return { host, supported };
}

async function load(): Promise<State> {
  const [settingsRes, usageRes, site] = await Promise.all([
    sendToBackground({ type: 'settings:get' }),
    sendToBackground({ type: 'usage:query', sinceMs: ALL_TIME_MS }),
    activeSite(),
  ]);
  return { settings: settingsRes.settings, events: usageRes.events, ...site };
}

async function patchSettings(patch: Partial<Settings>): Promise<void> {
  if (!state) return;
  state = { ...state, settings: { ...state.settings, ...patch } };
  render(); // optimistic, so the switch moves under the pointer
  const res = await sendToBackground({ type: 'settings:set', patch });
  if (state) {
    state = { ...state, settings: res.settings };
    render();
  }
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

function openDashboard(): void {
  void chrome.runtime.openOptionsPage();
  window.close();
}

function openSettings(): void {
  const path = chrome.runtime.getManifest().options_page ?? 'src/options/index.html';
  void chrome.tabs.create({ url: `${chrome.runtime.getURL(path)}#settings` });
  window.close();
}

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

function barFor(tier: Tier): HTMLElement {
  return h('span', { class: `bar bar-${tier}`, 'aria-hidden': 'true' });
}

type LockState = 'dancing' | 'paused' | 'asleep' | 'blocked';

/**
 * The lock IS the switch: one control, so there is no second toggle to
 * disagree with it. Its state is also spelled out in words below it, so the
 * animation is never the only signal.
 */
function lockSwitch(s: State, state: LockState): HTMLElement {
  const on = s.supported && s.settings.enabled;
  const label = !s.supported
    ? 'Protection is unavailable on this site'
    : `Protection ${s.settings.enabled ? 'on' : 'off'} for ${s.host ?? 'this site'}. Press to turn it ${s.settings.enabled ? 'off' : 'on'}.`;
  return h(
    'button',
    {
      type: 'button',
      class: `lock-btn ${state}`,
      role: 'switch',
      'aria-checked': on ? 'true' : 'false',
      'aria-label': label,
      'aria-disabled': s.supported ? undefined : 'true',
      'data-fid': 'power',
      onclick: () => {
        if (s.supported) void patchSettings({ enabled: !s.settings.enabled });
      },
    },
    h('span', { class: 'lock-wrap' }, lock(96, { large: true, className: 'lock' })),
    h('span', { class: 'shadow', 'aria-hidden': 'true' }),
  );
}

/**
 * Light or dark, for every surface the extension draws -- this popup, the
 * dashboard, and the panels on the chat page. It sits in the header rather
 * than in Settings because it is the one preference people flip on sight.
 */
function themeToggle(s: State): HTMLElement {
  const dark = s.settings.theme === 'dark';
  return h(
    'button',
    {
      type: 'button',
      class: 'theme-btn',
      'data-fid': 'theme',
      'aria-pressed': dark ? 'true' : 'false',
      'aria-label': dark ? 'Switch to light mode' : 'Switch to dark mode',
      title: dark ? 'Light mode' : 'Dark mode',
      onclick: () => void patchSettings({ theme: nextTheme(s.settings.theme) }),
    },
    dark ? icons.sun() : icons.moon(),
  );
}

function hero(s: State, blocked: boolean): HTMLElement {
  const on = s.supported && s.settings.enabled;
  let status: string;
  let dot = 'dot';
  let state: LockState = 'dancing';
  if (!s.supported) {
    status = 'Not active on this site';
    dot = 'dot off';
    state = 'asleep';
  } else if (!s.settings.enabled) {
    status = 'Protection is paused';
    dot = 'dot off';
    state = 'paused';
  } else if (blocked) {
    status = 'Last send was blocked';
    dot = 'dot hold';
    state = 'blocked';
  } else {
    status = 'Protection is on';
  }

  return h(
    'div',
    { class: 'hero' },
    blocked ? h('div', { class: 'hazard', 'aria-hidden': 'true' }) : null,
    h(
      'div',
      { class: 'hero-top' },
      h('div', { class: 'site' }, lock(22), h('span', {}, s.host ?? 'This site')),
      on ? h('span', { class: 'mode-label' }, MODE_COPY[s.settings.mode].label) : null,
      themeToggle(s),
    ),
    h(
      'div',
      { class: 'stage' },
      lockSwitch(s, state),
      h('div', { class: 'status' }, h('span', { class: dot }), status),
      // Not while a block is being explained: that state has to fit in Chrome's 600px popup.
      s.supported && !blocked ? h('div', { class: 'hint' }, s.settings.enabled ? 'tap me to pause' : 'tap me to wake up') : null,
    ),
  );
}

function statRow(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat' }, h('span', { class: 'l' }, label), h('span', { class: 'v' }, value));
}

function categories(s: State): HTMLElement {
  const day = summarize(today(s.events));
  let body: Child;
  if (day.byKind.length) {
    // Chrome caps a popup at 600px tall. Bound the chips so a busy day cannot
    // push the controls below the fold.
    const shown = day.byKind.slice(0, MAX_CHIPS);
    const hidden = day.byKind.length - shown.length;
    body = h(
      'div',
      { class: 'chips' },
      ...shown.map(({ kind, n }) =>
        h('span', { class: 'chip' }, barFor(KIND_INFO[kind].tier), `${KIND_INFO[kind].short} `, h('b', {}, String(n))),
      ),
      hidden > 0 ? h('span', { class: 'chip more' }, `+${hidden} more`) : null,
    );
  } else {
    body = h(
      'p',
      { class: 'copy' },
      s.events.length ? 'Nothing redacted yet today.' : 'Anything Deadbolt redacts shows up here.',
    );
  }
  return h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'Today by category'), body);
}

function modes(s: State): HTMLElement {
  const order: Array<[Mode, string]> = [
    ['watch', 'Watch'],
    ['autopilot', 'Autopilot'],
    ['strict', 'Strict'],
  ];
  return h(
    'div',
    { class: 'modes-wrap' },
    h(
      'div',
      { class: 'modes', role: 'group', 'aria-label': 'Mode' },
      ...order.map(([mode, label]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': s.settings.mode === mode ? 'true' : 'false',
            'data-fid': `mode-${mode}`,
            onclick: () => void patchSettings({ mode }),
          },
          label,
        ),
      ),
    ),
    h('div', { class: 'mode-note' }, MODE_COPY[s.settings.mode].note),
  );
}

function actions(s: State): HTMLElement {
  const paused = !s.settings.enabled;
  return h(
    'div',
    { class: 'actions' },
    h('button', { type: 'button', 'data-fid': 'dashboard', onclick: openDashboard }, icons.dashboard(), 'Dashboard'),
    h(
      'button',
      { type: 'button', 'data-fid': 'pause', onclick: () => void patchSettings({ enabled: paused }) },
      paused ? icons.play() : icons.pause(),
      paused ? 'Resume' : 'Pause',
    ),
    h('button', { type: 'button', 'data-fid': 'settings', onclick: openSettings }, icons.settings(), 'Settings'),
  );
}

function unsupported(): Child[] {
  return [
    h(
      'div',
      { class: 'section' },
      h(
        'p',
        { class: 'copy' },
        'Deadbolt only works on the chat sites it supports. Open one of them and this popup will show what it redacted.',
      ),
    ),
    h(
      'div',
      { class: 'list' },
      ...SUPPORTED_HOSTS.map((host) =>
        h('div', { class: 'list-row' }, h('span', { class: 'dot' }), h('span', { class: 'grow' }, host), h('span', { class: 'ok' }, 'Supported')),
      ),
    ),
    h('div', { class: 'cta' }, h('button', { type: 'button', class: 'btn ghost', 'data-fid': 'dashboard', onclick: openDashboard }, 'Open dashboard')),
  ];
}

function blockedNotice(): HTMLElement {
  return h(
    'div',
    { class: 'section notice' },
    h('p', { class: 'lead' }, 'A classification marking was found'),
    h('p', { class: 'copy', style: 'margin-top:4px' }, 'That prompt was not sent. Marked material is never sent, and there is no override.'),
  );
}

function build(s: State): Child[] {
  const last = s.events[s.events.length - 1];
  const blocked =
    s.supported && s.settings.enabled && last?.blocked === true && Date.now() - last.timestamp < BLOCKED_NOTICE_MS;

  if (!s.supported) return [hero(s, false), ...unsupported()];

  const week = summarize(lastDays(s.events, 7));
  const day = summarize(today(s.events));
  return [
    hero(s, blocked),
    blocked ? blockedNotice() : null,
    h(
      'div',
      { class: 'stats' },
      statRow('Redacted today', String(day.items)),
      statRow('Redacted in 7 days', String(week.items)),
      statRow('Sends blocked in 7 days', String(week.blocked)),
    ),
    // While a block is being explained, the explanation matters more than the chips.
    blocked ? null : categories(s),
    modes(s),
    actions(s),
  ];
}

function render(): void {
  if (!state) return;
  applyTheme(state.settings.theme);
  // Re-rendering replaces every node, so put keyboard focus back afterwards.
  const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['fid'] : undefined;
  app.replaceChildren(...(build(state).filter(Boolean) as Node[]));
  if (focusId) app.querySelector<HTMLElement>(`[data-fid="${focusId}"]`)?.focus();
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

let refreshTimer: number | undefined;
function refreshSoon(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void load().then((next) => {
      state = next;
      render();
    });
  }, 150);
}

async function boot(): Promise<void> {
  try {
    state = await load();
    render();
  } catch (err) {
    app.replaceChildren(
      h(
        'div',
        { class: 'section' },
        h('p', { class: 'lead' }, 'Could not read usage'),
        h('p', { class: 'copy', style: 'margin:4px 0 16px' }, `Try reloading the extension. ${String(err)}`),
      ),
    );
    return;
  }
  // The popup can stay open while a prompt is sent in another window.
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') refreshSoon();
  });
}

void boot();
