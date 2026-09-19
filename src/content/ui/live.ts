/**
 * The live detector panel.
 *
 * This is a development and demo surface, not the shipping ambient UI -- the
 * product's real ambient UI is a badge count. It exists because the
 * incremental cache and the settled/provisional rule are invisible by
 * construction, and an invisible mechanism is one nobody can debug or
 * believe.
 *
 * It deliberately does NOT touch the composer. Injecting highlight spans
 * into a ProseMirror contenteditable while the user types is the fastest way
 * to corrupt the editor's document state, and the failure mode is sending
 * text the user cannot see.
 */
import type { LiveFinding, ScanStats } from '../../worker/incremental';
import { el, getLayer } from './shell';

const SEVERITY_COLOR: Record<string, string> = {
  block: '#ff7b7b',
  high: '#ffb454',
  medium: '#8ab4f8',
  low: '#9aa1ad',
};

let panel: HTMLElement | null = null;
let body: HTMLElement | null = null;
let statLine: HTMLElement | null = null;

function ensure(): { body: HTMLElement; statLine: HTMLElement } {
  if (panel?.isConnected && body && statLine) return { body, statLine };

  body = el('div', { style: 'display:flex;flex-direction:column;gap:4px;' });
  statLine = el('div', {
    class: 'muted mono',
    style: 'font-size:10.5px;border-top:1px solid #262a33;padding-top:6px;',
  });

  panel = el(
    'div',
    {
      class: 'card',
      style:
        'position:absolute;left:16px;bottom:52px;width:340px;max-height:46vh;overflow:auto;' +
        'padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-size:12px;',
    },
    el(
      'div',
      {
        class: 'muted',
        style: 'font-size:10px;letter-spacing:.09em;text-transform:uppercase;',
      },
      'Live scan',
    ),
    body,
    statLine,
  );

  getLayer().append(panel);
  return { body, statLine };
}

/** Short status string for the model lane, shown next to the cache stats. */
export type NerState = 'off' | 'waiting' | 'running' | { spans: number } | { error: string };

let nerState: NerState = 'off';

export function setNerState(s: NerState): void {
  nerState = s;
}

function nerLabel(): string {
  if (nerState === 'off') return 'ner off';
  if (nerState === 'waiting') return 'ner idle';
  if (nerState === 'running') return 'ner running…';
  if ('error' in nerState) return `ner error: ${nerState.error.slice(0, 40)}`;
  return `ner ${nerState.spans} span${nerState.spans === 1 ? '' : 's'}`;
}

export function renderLive(findings: LiveFinding[], stats: ScanStats, textLength: number): void {
  if (!findings.length && textLength < 3) {
    hideLive();
    return;
  }

  const { body: b, statLine: s } = ensure();

  if (!findings.length) {
    b.replaceChildren(el('div', { class: 'muted', style: 'font-size:11.5px;' }, 'Nothing detected.'));
  } else {
    b.replaceChildren(
      ...findings.map((f) => {
        const dot = el('span', {
          style:
            `width:6px;height:6px;border-radius:50%;flex:0 0 auto;` +
            `background:${SEVERITY_COLOR[f.severity] ?? '#9aa1ad'};` +
            // A provisional finding is drawn hollow: the user can see the
            // detector is tracking it but has not committed to it.
            (f.settled ? '' : 'background:transparent;box-shadow:inset 0 0 0 1.5px ' +
              (SEVERITY_COLOR[f.severity] ?? '#9aa1ad') + ';'),
        });

        const value = f.value.length > 26 ? `${f.value.slice(0, 24)}…` : f.value;

        return el(
          'div',
          {
            style:
              'display:flex;align-items:center;gap:7px;' +
              (f.settled ? '' : 'opacity:.55;'),
          },
          dot,
          el('span', { class: 'mono', style: 'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, value),
          el('span', { class: 'muted', style: 'margin-left:auto;flex:0 0 auto;font-size:10.5px;' },
            f.settled ? f.label : 'watching…'),
        );
      }),
    );
  }

  const total = stats.hits + stats.misses;
  const pct = total ? Math.round((stats.hits / total) * 100) : 0;
  s.textContent =
    `${stats.chunks} chunks · ${stats.hits} cached / ${stats.misses} rescanned (${pct}%) · ` +
    `${stats.elapsedMs.toFixed(2)} ms · ${nerLabel()}`;
}

export function hideLive(): void {
  panel?.remove();
  panel = null;
  body = null;
  statLine = null;
}
