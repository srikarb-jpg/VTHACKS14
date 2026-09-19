/**
 * The live detector panel.
 *
 * This is a demo surface, not the shipping ambient UI -- the product's real
 * ambient UI is a badge count. It exists because the incremental cache and the
 * settled/provisional rule are invisible by construction, and an invisible
 * mechanism is one nobody can debug or believe.
 *
 * It says what it is doing in plain words ("Will be replaced", "Watching…")
 * and keeps the engine's numbers behind a Details toggle, so a first-time user
 * sees a friendly checklist and a developer can still get to the cache stats.
 *
 * It deliberately does NOT touch the composer. Injecting highlight spans
 * into a ProseMirror contenteditable while the user types is the fastest way
 * to corrupt the editor's document state, and the failure mode is sending
 * text the user cannot see.
 */
import type { LiveFinding, ScanStats } from '../../worker/incremental';
import { el, getLayer, lockLogo } from './shell';

let onRowPick: ((f: LiveFinding) => void) | null = null;

/** Clicking a row is the same gesture as clicking its underline. */
export function setLiveHandler(fn: (f: LiveFinding) => void): void {
  onRowPick = fn;
}

let panel: HTMLElement | null = null;
let body: HTMLElement | null = null;
let details: HTMLElement | null = null;
let detailsOpen = false;

function ensure(): { body: HTMLElement; details: HTMLElement } {
  if (panel?.isConnected && body && details) return { body, details };

  body = el('div', { class: 'pf-rows' });
  details = el('div', { class: 'pf-details' });
  details.hidden = !detailsOpen;

  const toggle = el('button', { class: 'pfl mini', type: 'button', 'aria-expanded': String(detailsOpen) }, 'Details');
  toggle.addEventListener('click', () => {
    detailsOpen = !detailsOpen;
    if (details) details.hidden = !detailsOpen;
    toggle.setAttribute('aria-expanded', String(detailsOpen));
  });

  panel = el(
    'section',
    { class: 'pf-card pf-live', role: 'region', 'aria-label': 'Live scan' },
    el('div', { class: 'pf-head' }, lockLogo(26), el('div', { class: 'pf-title' }, 'Checking as you type'), toggle),
    body,
    details,
  );

  getLayer().append(panel);
  return { body, details };
}

/** Status of the local model lane, shown in the details. */
export type NerState = 'off' | 'waiting' | 'running' | { spans: number } | { error: string };

let nerState: NerState = 'off';
let nerInferMs = 0;
let nerTotalMs = 0;

/** Last measured model time and end-to-end time, for the details. */
export function setNerTiming(inferMs: number, totalMs: number): void {
  nerInferMs = inferMs;
  nerTotalMs = totalMs;
}

export function setNerState(s: NerState): void {
  nerState = s;
}

function nerLabel(): string {
  if (nerState === 'off') return 'Local AI is off';
  if (nerState === 'waiting') return 'Local AI is idle';
  if (nerState === 'running') return 'Local AI is running…';
  if ('error' in nerState) return `Local AI error: ${nerState.error.slice(0, 60)}`;
  const timing = nerTotalMs ? ` (${nerInferMs} ms model, ${nerTotalMs} ms total)` : '';
  return `Local AI found ${nerState.spans} name${nerState.spans === 1 ? '' : 's'}${timing}`;
}

/** What the row tells the user about this finding, in plain words. */
function statusFor(f: LiveFinding): { text: string; ok: boolean } {
  if (f.confirmed) return { text: '✓ Replacing', ok: true };
  if (!f.settled) return { text: 'Watching…', ok: false };
  if (f.severity === 'block') return { text: 'Send will be blocked', ok: false };
  if (f.severity === 'low') return { text: 'Click to replace', ok: false };
  return { text: 'Will be replaced', ok: false };
}

function row(f: LiveFinding): HTMLElement {
  // Low-tier findings are the ones the user decides on. Everything above is
  // redacted automatically, so its row is informational.
  const clickable = (f.severity === 'low' && f.settled) || Boolean(f.confirmed);
  const status = statusFor(f);
  const value = f.value.length > 30 ? `${f.value.slice(0, 28)}…` : f.value;

  const node = el(
    'div',
    {
      // A provisional finding is drawn hollow: the user can see the detector
      // is tracking it but has not committed to it.
      class: `pf-row${f.settled ? '' : ' prov'}${clickable ? ' clickable' : ''}`,
      ...(clickable ? { role: 'button', tabindex: '0' } : {}),
    },
    el('span', { class: `pf-bar ${f.severity}${f.settled ? '' : ' prov'}`, 'aria-hidden': 'true' }),
    el('div', { class: 'pf-main' }, el('div', { class: 'pf-val' }, value), el('div', { class: 'pf-sub' }, f.label)),
    el('span', { class: `pf-state${status.ok ? ' ok' : ''}` }, status.text),
  );

  if (clickable) {
    const pick = (): void => onRowPick?.(f);
    node.addEventListener('click', pick);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
  }
  return node;
}

export function renderLive(findings: LiveFinding[], stats: ScanStats, textLength: number): void {
  if (!findings.length && textLength < 3) {
    hideLive();
    return;
  }

  const { body: b, details: d } = ensure();

  if (!findings.length) {
    b.replaceChildren(el('div', { class: 'pf-empty' }, 'Nothing sensitive so far.'));
  } else {
    b.replaceChildren(...findings.map(row));
  }

  const total = stats.hits + stats.misses;
  const pct = total ? Math.round((stats.hits / total) * 100) : 0;
  d.textContent =
    `Checked ${stats.chunks} chunk${stats.chunks === 1 ? '' : 's'}: ${stats.hits} reused, ${stats.misses} rescanned (${pct}% reused)\n` +
    `Scan time ${stats.elapsedMs.toFixed(2)} ms\n` +
    nerLabel();
}

export function hideLive(): void {
  panel?.remove();
  panel = null;
  body = null;
  details = null;
}
