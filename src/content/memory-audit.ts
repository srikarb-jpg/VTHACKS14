/**
 * Memory audit: find sensitive data Claude has already stored about you.
 *
 * Everything else in this extension acts before a message is sent. Memory is
 * the other half -- what earlier conversations left behind. Claude's memory
 * is on by default and, by third-party reports, is not cleared when a chat is
 * deleted, so old prompts can outlive the chats they came from.
 *
 * HOW WE READ IT. The first version scraped the Settings > Memory page. That
 * is a moving target we do not control: topics collapse and expand, text is
 * summarised until opened, and opening one re-flows the page underneath the
 * highlights. So instead we ask Claude the way Anthropic's own help page
 * documents for exporting memory -- one fixed prompt -- and scan the reply,
 * which is ordinary chat text: complete, in one place, and static once
 * streaming ends.
 *
 * It only ever reads. Removing a memory is irreversible, so the user does
 * that with Claude's own controls, guided by what we point out. Nothing is
 * sent anywhere except that one prompt to Claude, and nothing is stored.
 */
import { scan, resolveOverlaps } from '../worker/detectors';
import { splitStable } from '../worker/chunks';
import { nerSpansToFindings } from '../worker/ner-map';
import type { LiveFinding } from '../worker/incremental';
import type { Finding } from '../shared/types';
import type { NerSpan } from '../shared/ner';
import { sendToBackground } from '../shared/messages';
import { buildTextMap, offsetToRange, type TextMap } from './textmap';
import { renderHighlights, clearHighlights } from './ui/highlights';
import { el, getLayer } from './ui/shell';
import { summarizeFindings, dropOwnNames } from './audit-summary';
import { addedSince, endOfLast } from './anchor';

/** Anthropic's documented way to export memory, verbatim. */
export const MEMORY_PROMPT =
  'Write out your memories of me verbatim, exactly as they appear in your memory.';

const POLL_MS = 700;
/** Unchanged polls (about 2.8s) before a reply with no Stop control showing is finished. */
const QUIET_POLLS = 4;
/** Unchanged polls (about 10s) after which we stop trusting the Stop control. */
const QUIET_POLLS_FORCE = 14;
/** A long reply takes a while to write; this is a ceiling, not a target. */
const TIMEOUT_MS = 150_000;
/** How long to look for our prompt before falling back to a before/after diff. */
const ANCHOR_GRACE_MS = 10_000;
/** Above this the model is skipped: the regex tier still runs. */
const MAX_NER_CHARS = 200_000;

export interface AuditDeps {
  nerEnabled: () => boolean;
  /** Is there an empty composer on a page where a fresh chat makes sense? */
  canStart: () => boolean;
  /** Write the prompt and send it, verified. Resolves false if it could not. */
  sendPrompt: (text: string) => Promise<boolean>;
}

let deps: AuditDeps | null = null;
let active = false;
let map: TextMap | null = null;
let live: LiveFinding[] = [];
let run = 0;
let launcher: HTMLElement | null = null;
let panel: HTMLElement | null = null;

/** While true the composer's own scan must stay out of the shared highlight layer. */
export function isAuditActive(): boolean {
  return active;
}

/**
 * The whole page, not a guessed container. An earlier version scoped this to
 * <main>, which is a claim about claude.ai's markup we cannot check from here;
 * anchoring on our own prompt makes the container irrelevant.
 */
function chatRoot(): HTMLElement {
  return document.body;
}

/** Best-effort: while Claude is still generating, a stop control is on screen. */
function isStreaming(): boolean {
  return document.querySelector('button[aria-label*="Stop" i]') !== null;
}

function syncLauncher(): void {
  const show = !active && (deps?.canStart() ?? false);
  if (!show) {
    launcher?.remove();
    launcher = null;
    return;
  }
  if (launcher?.isConnected) return;
  launcher = el(
    'button',
    { class: 'pfl primary', type: 'button', style: 'position:fixed;left:16px;bottom:16px;padding:9px 14px;font-size:13px' },
    'Audit what Claude remembers',
  );
  launcher.addEventListener('click', () => void audit());
  getLayer().append(launcher);
}

export function stopMemoryAudit(): void {
  if (!active) return;
  active = false;
  run++;
  map = null;
  live = [];
  panel?.remove();
  panel = null;
  clearHighlights();
  syncLauncher();
}

function show(f: LiveFinding): void {
  if (!map) return;
  const range = offsetToRange(map, f.start, f.end);
  range?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function paint(note: string, advice = false): void {
  if (map) renderHighlights(map, live);

  const rows = live.map((f) => {
    const value = f.value.length > 30 ? `${f.value.slice(0, 28)}…` : f.value;
    const row = el(
      'div',
      { class: 'pf-row clickable', role: 'button', tabindex: '0' },
      el('span', { class: `pf-bar ${f.severity}`, 'aria-hidden': 'true' }),
      el('div', { class: 'pf-main' }, el('div', { class: 'pf-val' }, value), el('div', { class: 'pf-sub' }, f.label)),
      el('span', { class: 'pf-state' }, 'Show'),
    );
    row.addEventListener('click', () => show(f));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show(f);
      }
    });
    return row;
  });

  const rescan = el('button', { class: 'pfl mini', type: 'button' }, 'Close');
  rescan.addEventListener('click', stopMemoryAudit);

  panel?.remove();
  panel = el(
    'section',
    { class: 'pf-card pf-live', role: 'region', 'aria-label': 'Memory audit' },
    el('div', { class: 'pf-head' }, el('div', { class: 'pf-title' }, 'Memory audit'), rescan),
    ...(advice ? [el('div', { class: 'pf-sub', style: 'margin:6px 0' }, summarizeFindings(live))] : []),
    ...(note ? [el('div', { class: 'pf-sub', style: 'margin:6px 0' }, note)] : []),
    el('div', { class: 'pf-rows', style: 'max-height:260px;overflow:auto' }, ...rows),
    ...(advice
      ? [
          el(
            'div',
            { class: 'pf-sub', style: 'margin-top:8px' },
            'Read-only. To remove something, edit it in Settings → Memory. This chat now contains your memory text, so delete it when you are done.',
          ),
        ]
      : []),
  );
  getLayer().append(panel);
}

interface Reply {
  map: TextMap;
  /** The reply is map.text.slice(start, end). */
  start: number;
  end: number;
}

/**
 * Wait for Claude's reply to finish.
 *
 * "Finished" is judged by the text having stopped changing, plus the Stop
 * control being gone -- but that control is a guess at claude.ai's markup, so
 * after a long enough quiet spell we stop consulting it. At the deadline we
 * take what is there rather than discard a reply the user can see is complete.
 *
 * The reply is located by anchoring on our own prompt. If that fails (the page
 * renders it differently than expected) we fall back to diffing the page
 * against a snapshot taken before we sent anything.
 */
async function waitForReply(
  id: number,
  before: string,
  progress: (note: string) => void,
): Promise<Reply | null> {
  const started = Date.now();
  let lastLength = -1;
  let quiet = 0;
  let best: Reply | null = null;
  let lastLog = '';
  let lastNote = '';

  while (Date.now() - started < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (id !== run) return null;

    const m = buildTextMap(chatRoot());
    let start = endOfLast(m.text, MEMORY_PROMPT);
    let end = m.text.length;
    let how = 'prompt anchor';
    if (start < 0 && Date.now() - started > ANCHOR_GRACE_MS) {
      const added = addedSince(before, m.text);
      if (added.end > added.start) {
        start = added.start;
        end = added.end;
        how = 'before/after diff';
      }
    }
    const streaming = isStreaming();
    const length = start < 0 ? -1 : end - start;

    if (length > 0) best = { map: m, start, end };
    quiet = length > 0 && length === lastLength ? quiet + 1 : 0;
    lastLength = length;

    const state =
      `${start < 0 ? 'request NOT found in page' : `found via ${how}`}, reply ${length} chars, ` +
      `quiet ${quiet}, stop-button ${streaming ? 'yes' : 'no'}`;
    if (state !== lastLog) {
      console.info(`[prompt-firewall] memory audit: ${state}`);
      lastLog = state;
    }
    // Show progress in the panel too, so a stall is visible without DevTools.
    const note =
      length > 0
        ? `Waiting for Claude’s reply… ${length.toLocaleString()} characters so far`
        : start < 0
          ? 'Waiting for the request to appear in the page…'
          : 'Waiting for Claude’s reply…';
    if (note !== lastNote) {
      lastNote = note;
      progress(note);
    }

    const still = quiet >= QUIET_POLLS && !streaming;
    const forced = quiet >= QUIET_POLLS_FORCE;
    if (best && (still || forced)) return best;
  }
  return best;
}

async function audit(): Promise<void> {
  if (!deps) return;
  const id = ++run;
  active = true;
  launcher?.remove();
  launcher = null;
  map = null;
  live = [];
  // Snapshot BEFORE anything is sent: the fallback locates the reply by what
  // has appeared since.
  const before = buildTextMap(chatRoot()).text;
  paint('Asking Claude what it remembers about you…');

  if (!(await deps.sendPrompt(MEMORY_PROMPT))) {
    if (id === run) paint('Could not send the request. Open a new chat and try again.');
    return;
  }

  paint('Waiting for Claude’s reply…');
  const got = await waitForReply(id, before, (note) => {
    if (id === run) paint(note);
  });
  if (id !== run) return;
  if (!got) {
    paint('Timed out waiting for Claude’s reply.');
    return;
  }

  map = got.map;
  const base = got.start;
  const reply = got.map.text.slice(got.start, got.end);
  console.info(`[prompt-firewall] memory audit: reply is ${reply.length} chars`);

  const inDoc = (fs: Finding[]): LiveFinding[] =>
    dropOwnNames(fs).map((f) => ({ ...f, start: f.start + base, end: f.end + base, settled: true }));

  const regex = scan(reply).findings;
  live = inDoc(regex);

  // A very short reply usually means Claude has nothing stored, or memory is
  // off -- which must not read as "your memory is clean".
  if (reply.trim().length < 60) {
    paint(`Claude replied with very little (“${reply.trim().slice(0, 80)}”). Memory may be empty or turned off.`);
    return;
  }

  const useModel = deps.nerEnabled() && reply.length <= MAX_NER_CHARS;
  paint(useModel ? 'Checking names with the local model…' : '', !useModel);
  if (!useModel) return;

  try {
    const chunks = splitStable(reply);
    const res = await sendToBackground({ type: 'ner:detect', texts: chunks.map((c) => c.text) });
    if (id !== run) return;
    if (res.error) {
      paint(`Local model unavailable (${res.error.slice(0, 60)}). Showing pattern matches only.`, true);
      return;
    }
    const spans: NerSpan[] = [];
    chunks.forEach((c, i) => {
      for (const s of res.spans[i] ?? []) spans.push({ ...s, start: s.start + c.start, end: s.end + c.start });
    });
    live = inDoc(resolveOverlaps([...regex, ...nerSpansToFindings(spans, reply)]));
    paint('', true);
  } catch (err) {
    if (id === run) paint(`Local model unavailable (${String(err).slice(0, 60)}).`, true);
  }
}

export function startMemoryAudit(d: AuditDeps): void {
  deps = d;
  window.setInterval(syncLauncher, 1000);
  const redraw = (): void => {
    if (active && map) renderHighlights(map, live);
  };
  window.addEventListener('scroll', redraw, { capture: true, passive: true });
  window.addEventListener('resize', redraw, { passive: true });
}
