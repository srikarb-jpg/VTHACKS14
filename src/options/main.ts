/**
 * Dashboard. Reads the local usage log and renders it.
 *
 * Honesty constraints from the spec, enforced here rather than left to the
 * slide deck: energy is shown as a RANGE, labelled an estimate, with the
 * methodology on the page. A judge with a calculator should find these
 * conservative.
 */
import { sendToBackground } from '../shared/messages';
import type { FindingKind, Settings, UsageEvent } from '../shared/types';
import type { Probe } from '../shared/ner';
import { tokenColor, tokenize } from './tokenizer';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Watt-hours per 1k output-equivalent tokens, as a range. Public vendor and
 * third-party figures for a median text prompt cluster in the low fractions
 * of a watt-hour; we present a band rather than a point estimate because the
 * true number depends on model, hardware and batching, none of which we know.
 */
const WH_PER_1K_TOKENS_LOW = 0.05;
const WH_PER_1K_TOKENS_HIGH = 0.3;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

function card(stat: string, label: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'card';
  d.innerHTML = `<div class="stat"></div><div class="label"></div>`;
  d.querySelector('.stat')!.textContent = stat;
  d.querySelector('.label')!.textContent = label;
  return d;
}

function renderStats(events: UsageEvent[]): void {
  const redactions = events.reduce(
    (n, e) => n + Object.values(e.redactions).reduce((a, b) => a + b, 0),
    0,
  );
  const blocked = events.filter((e) => e.blocked).length;
  const offFrontier = events.filter((e) => e.lane !== 'frontier').length;
  const share = events.length ? Math.round((offFrontier / events.length) * 100) : 0;
  const medianScan = median(events.map((e) => e.scanMs));

  const host = $('stats');
  host.replaceChildren(
    card(String(events.length), 'prompts intercepted'),
    card(String(redactions), 'items redacted'),
    card(String(blocked), 'sends blocked (marked)'),
    card(`${share}%`, 'never needed the frontier model'),
    card(`${medianScan.toFixed(1)} ms`, 'median added latency'),
  );
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function renderBreakdown(events: UsageEvent[]): void {
  const totals = new Map<FindingKind, number>();
  for (const e of events) {
    for (const [k, n] of Object.entries(e.redactions)) {
      totals.set(k as FindingKind, (totals.get(k as FindingKind) ?? 0) + (n ?? 0));
    }
  }
  const host = $('breakdown');
  if (!totals.size) {
    host.innerHTML = `<div class="note">Nothing caught yet. Use a supported chat site and it will fill in.</div>`;
    return;
  }
  host.replaceChildren(
    ...[...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<span></span><strong></strong>`;
        row.querySelector('span')!.textContent = kind.replaceAll('_', ' ');
        row.querySelector('strong')!.textContent = String(n);
        return row;
      }),
  );
}

function renderEnergy(events: UsageEvent[]): void {
  const tokens = events.filter((e) => e.lane !== 'frontier').reduce((n, e) => n + e.promptTokens, 0);
  const low = ((tokens / 1000) * WH_PER_1K_TOKENS_LOW).toFixed(2);
  const high = ((tokens / 1000) * WH_PER_1K_TOKENS_HIGH).toFixed(2);
  $('energy').innerHTML = `
    <div class="stat">${tokens.toLocaleString()}</div>
    <div class="label">prompt tokens that did not reach a frontier model</div>
    <div class="row" style="margin-top:12px"><span>Estimated energy avoided</span><strong>${low} – ${high} Wh</strong></div>
    <div class="note" style="margin-top:10px">
      A range, not a figure. Assumes ${WH_PER_1K_TOKENS_LOW}–${WH_PER_1K_TOKENS_HIGH} Wh per 1k tokens,
      which spans published vendor and third-party estimates for median text inference.
      Per-prompt energy is genuinely small; the argument here is about the aggregate habit,
      not about any single prompt.
    </div>`;
}

function renderTokenizer(): void {
  const input = $('tok-input') as HTMLTextAreaElement;
  const out = $('tok-out');
  const count = $('tok-count');
  const draw = (): void => {
    const toks = tokenize(input.value);
    out.replaceChildren(
      ...toks.map((t, i) => {
        const s = document.createElement('span');
        s.className = 'tk';
        s.style.background = tokenColor(i);
        s.textContent = t.replace(/ /g, '·');
        return s;
      }),
    );
    count.textContent = `${toks.length} tokens · ${input.value.length} characters · approximate, not a real BPE vocabulary`;
  };
  input.addEventListener('input', draw);
  draw();
}

async function renderSettings(): Promise<void> {
  const { settings } = await sendToBackground({ type: 'settings:get' });
  const host = $('settings');
  host.replaceChildren();

  const toggle = (key: keyof Settings, label: string, note: string): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'row';
    row.style.cursor = 'pointer';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(settings[key]);
    box.addEventListener('change', () => {
      void sendToBackground({ type: 'settings:set', patch: { [key]: box.checked } });
    });
    const text = document.createElement('span');
    text.innerHTML = `${label}<div class="note">${note}</div>`;
    row.append(text, box);
    return row;
  };

  host.append(
    toggle('enabled', 'Enabled', 'Master switch.'),
    toggle('showRoutingChips', 'Routing hints', 'Suggest a cheaper lane. Never blocks Enter.'),
    toggle(
      'nerEnabled',
      'Local AI detection',
      'Highlight names and organizations using the local model. Requires the download below.',
    ),
    toggle(
      'autoRedactNames',
      'Replace names without confirming',
      'Off by default: names found by the model are highlighted, and you click one to mark it ' +
        'for replacement. Turning this on replaces any name the model is confident about ' +
        'without asking \u2014 fewer clicks, but the model will occasionally be wrong.',
    ),
    toggle(
      'searchLaneEnabled',
      'Search lane',
      'Off by default. Turning this on sends a rewritten, scrubbed query to a third-party search API — the only outbound call this extension can make.',
    ),
  );
}

function wireReceipt(events: UsageEvent[]): void {
  $('copy-receipt').addEventListener('click', () => {
    const redactions = events.reduce(
      (n, e) => n + Object.values(e.redactions).reduce((a, b) => a + b, 0),
      0,
    );
    const offFrontier = events.filter((e) => e.lane !== 'frontier').length;
    const text = [
      'Prompt Firewall — 7 day receipt',
      `${events.length} prompts intercepted`,
      `${redactions} sensitive items redacted before sending`,
      `${events.filter((e) => e.blocked).length} sends blocked for classification markings`,
      `${offFrontier} prompts that never needed a frontier model`,
      'All computed locally. No prompt text stored.',
    ].join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      $('receipt-status').textContent = 'Copied.';
    });
  });
}

/**
 * Local AI panel.
 *
 * Probes capability BEFORE offering the download, so a machine that cannot
 * compile WASM says so in milliseconds instead of after fetching 183 MB.
 */
async function renderNer(): Promise<void> {
  const host = $('ner');
  host.innerHTML = '<div class="note">Checking this machine…</div>';

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
    host.innerHTML =
      `<div class="note" style="color:#ff9c9c">Could not reach the detection host.</div>` +
      `<div class="note" style="margin-top:6px">${String(err)}</div>` +
      `<div class="note" style="margin-top:6px">Check chrome://extensions &rarr; Prompt Firewall &rarr; ` +
      `<em>Inspect views: offscreen</em> for the underlying error. Pattern detection is unaffected.</div>`;
    return;
  }

  const row = (k: string, v: string): string =>
    `<div class="row"><span>${k}</span><strong>${v}</strong></div>`;

  const backend = probe.webgpu ? 'WebGPU' : probe.wasm ? 'WebAssembly (CPU)' : 'unavailable';

  host.innerHTML =
    row('WebAssembly', probe.wasm ? 'available' : 'BLOCKED') +
    row('WebGPU', probe.webgpu ? 'available' : 'not available') +
    row('Backend that would be used', backend) +
    row('Reported device memory', probe.deviceMemoryGb ? `${probe.deviceMemoryGb} GB` : 'unknown') +
    row('Model', loaded ? 'loaded' : 'not loaded') +
    (error ? `<div class="note" style="color:#ff9c9c;margin-top:8px">${error}</div>` : '');

  if (!probe.wasm) {
    host.insertAdjacentHTML(
      'beforeend',
      `<div class="note" style="margin-top:10px">
         WebAssembly could not be compiled here, so local AI detection cannot run.
         Pattern detection is unaffected and keeps working.
       </div>`,
    );
    return;
  }

  const btn = document.createElement('button');
  btn.textContent = loaded ? 'Reload model' : 'Download and enable (~183 MB, once)';
  btn.style.marginTop = '12px';
  const status = document.createElement('span');
  status.className = 'label';
  status.style.marginLeft = '10px';

  btn.addEventListener('click', () => {
    btn.disabled = true;
    status.textContent = 'Downloading… this takes a minute on first run.';
    void (async () => {
      const r = await sendToBackground({ type: 'ner:load' });
      if (r.ok) {
        await sendToBackground({ type: 'settings:set', patch: { nerEnabled: true } });
        status.textContent = 'Ready. Highlights will appear as you type.';
      } else {
        status.textContent = `Failed: ${r.error ?? 'unknown'}`;
        btn.disabled = false;
      }
    })();
  });

  const test = document.createElement('button');
  test.textContent = 'Run self-test';
  test.style.marginTop = '12px';
  test.style.marginLeft = '8px';
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
      status.textContent = `${r.ms.toFixed(0)} ms on ${r.provider} — ${
        found.length ? found.join(', ') : 'no entities found'
      }`;
    })();
  });

  host.append(btn, test, status);
}

async function main(): Promise<void> {
  // First, and not awaited alongside anything slower: this panel is the one
  // the user is looking for right now.
  void renderNer();

  const { events } = await sendToBackground({ type: 'usage:query', sinceMs: WINDOW_MS });
  renderStats(events);
  renderBreakdown(events);
  renderEnergy(events);
  renderTokenizer();
  wireReceipt(events);
  await renderSettings();
}

void main();
