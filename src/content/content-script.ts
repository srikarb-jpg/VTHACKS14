/**
 * Content script entry. Wires the adapter, the gate, the scanner and the UI.
 *
 * The decision tree at submit, in severity order:
 *
 *   block  -> cancel the send, show the explainer. Nothing leaves.
 *   high   -> redact, send, toast with undo.
 *   medium -> redact, send, toast (or treat as high in strict mode).
 *   low    -> send unchanged; highlights stay for the user to act on.
 *   clean  -> do not interfere at all.
 *
 * The scanner runs in-process rather than in a Web Worker. The spec called
 * for a worker to keep NER and the embedder off the UI thread; with those
 * cut, the remaining detectors are pure regex over a few kilobytes and
 * measure well under a millisecond. The module boundary is preserved so a
 * worker can be dropped back in without touching this file.
 */
import { scan as fullScan } from '../worker/detectors';
import {
  IncrementalScanner,
  markSettled,
  maxSeverity,
  type LiveFinding,
} from '../worker/incremental';
import { redact, revertOne } from '../worker/redact';
import { sendToBackground } from '../shared/messages';
import { SUBMIT_LATENCY_BUDGET_MS, TYPING_DEBOUNCE_MS, wrapToken } from '../shared/config';
import type { Finding, Placeholder, Settings, UsageEvent } from '../shared/types';
import { ClaudeAdapter } from './adapters/claude';
import { SubmitGate, type GateVerdict } from './gate';
import { route, worthSuggesting } from './router';
import { startRehydration } from './rehydrate';
import { showToast, dismissToast } from './ui/toast';
import { showDiff, closeDiff } from './ui/diff';
import { showBlockPanel } from './ui/cui-block';
import { showChip, dismissChip } from './ui/chip';
import { showReady } from './ui/ready';
import { renderLive, hideLive, setNerState, setNerTiming } from './ui/live';
import {
  renderHighlights,
  clearHighlights,
  setHighlightHandler,
} from './ui/highlights';
import type { TextMap } from './textmap';
import type { NerSpan } from '../shared/ner';
import { splitStable, hash } from '../worker/chunks';
import { nerSpansToFindings } from '../worker/ner-map';
import { resolveOverlaps } from '../worker/detectors';

const adapter = new ClaudeAdapter();

/**
 * One scanner for the whole page, shared by the typing pass and the submit
 * pass. That sharing IS the optimisation: by the time Enter is pressed, the
 * cache is already warm from typing, so the authoritative scan only has to
 * re-run detection on whatever chunk is still dirty.
 */
const scanner = new IncrementalScanner((text) => fullScan(text).findings);
let settings: Settings = {
  mode: 'autopilot',
  enabled: true,
  searchLaneEnabled: false,
  showRoutingChips: true,
  nerEnabled: false,
};

/** Crude token estimate. Four characters per token is the usual rule of thumb. */
const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

/**
 * Both autopilot and strict redact down to the medium tier. The difference
 * between them per the spec is a confirmation step before sending on a
 * high-severity finding, which is NOT YET IMPLEMENTED -- strict currently
 * behaves as autopilot. Wire the confirmation in `onSubmitAttempt` by
 * returning 'hold' and sending from the confirm handler.
 */
const REDACTION_THRESHOLD = 'medium' as const;

const gate = new SubmitGate(adapter, {
  onSubmitAttempt(text): GateVerdict {
    if (!settings.enabled || settings.mode === 'watch') {
      void logUsage(text, scanNow(text).elapsedMs, [], false);
      return 'send';
    }

    const result = scanNow(text);
    if (result.elapsedMs > SUBMIT_LATENCY_BUDGET_MS) {
      console.warn(`[prompt-firewall] scan took ${result.elapsedMs.toFixed(1)}ms, over budget`);
    }

    // --- block tier -------------------------------------------------------
    if (result.maxSeverity === 'block') {
      const blocking = result.findings.filter((f) => f.severity === 'block');
      showBlockPanel({ findings: blocking, onDismiss: () => undefined });
      void logUsage(text, result.elapsedMs, [], true);
      void sendToBackground({ type: 'badge:increment', redactions: blocking.length, reroutes: 0 });
      return 'cancel';
    }

    // --- nothing to redact ------------------------------------------------
    const actionable = result.findings.filter(
      (f) => f.severity === 'high' || f.severity === 'medium',
    );
    if (!actionable.length) {
      void logUsage(text, result.elapsedMs, [], false);
      return 'send';
    }

    // --- redact and send ourselves ---------------------------------------
    const r = redact(text, result.findings, REDACTION_THRESHOLD);
    if (!adapter.writeText(r.redacted)) {
      // We could not rewrite the composer. Cancelling is the only safe
      // option: letting the event through would send the ORIGINAL text.
      console.error('[prompt-firewall] composer write failed; send cancelled');
      return 'cancel';
    }

    void sendToBackground({ type: 'vault:put', placeholders: r.placeholders });
    void sendToBackground({
      type: 'badge:increment',
      redactions: r.placeholders.length,
      reroutes: 0,
    });
    void logUsage(text, result.elapsedMs, r.placeholders, false);

    gate.sendWithoutIntercepting();

    showToast({
      placeholders: r.placeholders,
      onUndo: () => {
        adapter.writeText(r.original);
      },
      onOpenDiff: () => openDiff(r.original, r.redacted, r.placeholders),
    });

    return 'hold';
  },
});

/**
 * The authoritative scan. Always runs on the complete final text, always
 * through the shared cache. Correctness never depends on the typing pass
 * having happened -- that pass only makes this one cheap.
 */
function scanNow(text: string) {
  const { findings, stats } = scanner.scan(text);
  return { findings, maxSeverity: maxSeverity(findings), elapsedMs: stats.elapsedMs };
}

function openDiff(original: string, redacted: string, placeholders: Placeholder[]): void {
  let currentText = redacted;
  let remaining = [...placeholders];

  const render = (): void =>
    showDiff({
      original,
      redacted: currentText,
      placeholders: remaining,
      onRevert: (token) => {
        const p = remaining.find((x) => x.token === token);
        if (!p) return;
        currentText = revertOne(currentText, p);
        remaining = remaining.filter((x) => x.token !== token);
        render();
      },
      onClose: closeDiff,
    });

  render();
}

async function logUsage(
  text: string,
  scanMs: number,
  placeholders: Placeholder[],
  blocked: boolean,
): Promise<void> {
  const redactions: UsageEvent['redactions'] = {};
  for (const p of placeholders) redactions[p.kind] = (redactions[p.kind] ?? 0) + 1;
  await sendToBackground({
    type: 'usage:record',
    event: {
      timestamp: Date.now(),
      host: adapter.site,
      lane: route(text).lane,
      blocked,
      redactions,
      promptTokens: estimateTokens(text),
      scanMs,
    },
  });
}

// ---------------------------------------------------------------------------
// Advisory pass while typing. Never alters text; only surfaces the chip.
// ---------------------------------------------------------------------------

let typingTimer: number | undefined;
let idleHandle: number | undefined;

/**
 * The advisory pass. Runs on a debounce while typing and never alters text.
 *
 * Scheduled inside requestIdleCallback so a fast typist never competes with
 * the scan for the main thread. Typing must never stutter -- if it does, the
 * ad-blocker premise fails no matter how good the detection is.
 */
/** Kept so scroll and resize can redraw without rescanning. */
let lastMap: TextMap | null = null;
let lastLive: LiveFinding[] = [];

function advisoryScan(): void {
  lastScanAt = performance.now();
  const map = adapter.readTextMap();
  const text = (map?.text ?? '').trimEnd();
  if (text.trim().length < 3) {
    hideLive();
    clearHighlights();
    dismissChip();
    lastMap = null;
    lastLive = [];
    return;
  }

  const { findings, stats } = scanner.scan(text);
  const caret = adapter.getCaretOffset();
  const live = markSettled(findings, text, caret);
  lastMap = map;
  lastLive = live;
  renderLive(live, stats, text.length);
  if (map) renderHighlights(map, live);

  // NER runs alongside, never in front. Results arrive late and merge into
  // whatever is already on screen; if they never arrive, nothing breaks,
  // because the low tier only ever draws underlines.
  if (!settings.nerEnabled) {
    setNerState('off');
  } else if (text !== nerFor) {
    // A scan triggered by caret movement or the staleness timer does not
    // need the model re-run on text it has already seen.
    void runNer(text);
  }

  if (!settings.showRoutingChips) {
    dismissChip();
    return;
  }
  const decision = route(text);
  if (!worthSuggesting(decision)) {
    dismissChip();
    return;
  }
  showChip(
    {
      decision,
      onAccept: () => {
        // The search lane ships disabled; accepting is a no-op placeholder
        // until that lane exists. Logged so overrides become training data.
        console.info('[prompt-firewall] lane accepted', decision.lane);
      },
      onDismiss: () => undefined,
    },
    adapter.getAnchor(),
  );
}

let lastScanAt = 0;

/**
 * Upper bound on how stale the panel may get.
 *
 * A pure debounce starves under sustained typing: at 120 wpm the gap between
 * keystrokes is roughly 80 ms, so a 300 ms timer is cancelled every time and
 * never fires. The boundary-key path (60 ms) usually rescues this, because
 * spaces are frequent and 60 ms fits inside an 80 ms gap -- but "usually" is
 * not a guarantee, and a fast burst with no spaces would starve completely.
 *
 * So: if it has been longer than this since the last scan, run immediately
 * instead of debouncing. Detection is then guaranteed at least this often
 * regardless of typing speed.
 */
const MAX_STALENESS_MS = 700;

function runAdvisorySoon(): void {
  if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
  idleHandle = requestIdleCallback(() => advisoryScan(), { timeout: 200 });
}

/**
 * NER, run through the same chunk cache as the regex tier.
 *
 * Originally this sent the WHOLE prompt to the model on every scan, which is
 * exactly the mistake the chunk cache exists to prevent: a 6-sentence prompt
 * re-ran inference over all 6 sentences for every keystroke pause. Now each
 * sentence is hashed, cached, and only dirty ones are sent -- batched into
 * one call, because GLiNER accepts several texts at once and the per-call
 * overhead is paid once rather than per chunk.
 *
 * Single-flight remains: ONNX cannot abort a forward pass once started, so a
 * second is refused and only the newest pending text is chased.
 */
const nerCache = new Map<string, NerSpan[]>();
const NER_CACHE_MAX = 256;

let nerInFlight = false;
let nerPending: string | null = null;
let nerFor = '';
let nerFindings: Finding[] = [];

function cacheNer(key: string, spans: NerSpan[]): void {
  nerCache.set(key, spans);
  if (nerCache.size > NER_CACHE_MAX) {
    const oldest = nerCache.keys().next().value;
    if (oldest !== undefined) nerCache.delete(oldest);
  }
}

async function runNer(text: string): Promise<void> {
  if (nerInFlight) {
    nerPending = text;
    return;
  }
  nerInFlight = true;
  setNerState('running');
  try {
    const chunks = splitStable(text);
    const dirty: { index: number; text: string }[] = [];
    const perChunk: (NerSpan[] | null)[] = chunks.map((c, i) => {
      const cached = nerCache.get(hash(c.text));
      if (cached) return cached;
      dirty.push({ index: i, text: c.text });
      return null;
    });

    let timing = '';
    if (dirty.length > 0) {
      const t0 = performance.now();
      const res = await sendToBackground({
        type: 'ner:detect',
        texts: dirty.map((d) => d.text),
      });
      const totalMs = performance.now() - t0;
      // Three nested measurements. Model time is inferMs; the gap up to
      // roundTripMs is background<->offscreen messaging; the gap up to
      // totalMs is content<->background, including waking the service
      // worker. Whichever dominates is the thing to fix.
      timing =
        ` | infer ${res.inferMs.toFixed(0)}ms` +
        ` + offscreen-msg ${(res.roundTripMs - res.inferMs).toFixed(0)}ms` +
        ` + sw-msg ${(totalMs - res.roundTripMs).toFixed(0)}ms` +
        ` = ${totalMs.toFixed(0)}ms`;
      setNerTiming(Math.round(res.inferMs), Math.round(totalMs));
      if (res.error) {
        console.warn('[prompt-firewall] ner error', res.error);
        setNerState({ error: res.error });
        return;
      }
      dirty.forEach((d, i) => {
        const spans = res.spans[i] ?? [];
        cacheNer(hash(d.text), spans);
        perChunk[d.index] = spans;
      });
    }

    // Rebase each chunk's spans into document coordinates.
    const all: NerSpan[] = [];
    chunks.forEach((c, i) => {
      for (const s of perChunk[i] ?? []) {
        all.push({ ...s, start: s.start + c.start, end: s.end + c.start });
      }
    });

    nerFindings = nerSpansToFindings(all, text);
    nerFor = text;
    setNerState({ spans: nerFindings.length });
    console.info(
      `[prompt-firewall] ner: ${chunks.length} chunks, ${dirty.length} sent, ` +
        `${all.length} spans -> ${nerFindings.length} findings${timing}`,
    );
    repaintWithNer();
  } catch (err) {
    console.warn('[prompt-firewall] ner unavailable', err);
    setNerState({ error: String(err) });
  } finally {
    nerInFlight = false;
    const next = nerPending;
    nerPending = null;
    if (next !== null && next !== nerFor) void runNer(next);
  }
}

/**
 * Merge late NER findings into the current display. Discarded outright if
 * the text changed while the model was thinking -- stale offsets would draw
 * underlines in the wrong place, which is worse than drawing none.
 */
function repaintWithNer(): void {
  const current = adapter.readText();
  if (current !== nerFor || !lastMap) return;
  const merged = resolveOverlaps([...lastLive, ...nerFindings]);
  const live = markSettled(merged, current, adapter.getCaretOffset());
  lastLive = live;
  renderLive(live, scanner.stats, current.length);
  renderHighlights(lastMap, live);
}

function scheduleAdvisory(delay: number): void {
  if (!settings.enabled) return;
  window.clearTimeout(typingTimer);
  if (performance.now() - lastScanAt > MAX_STALENESS_MS) {
    runAdvisorySoon();
    return;
  }
  typingTimer = window.setTimeout(runAdvisorySoon, delay);
}

/** Word boundaries settle a match, so scan sooner than the full debounce. */
const BOUNDARY_KEYS = new Set([' ', ',', '.', ';', ':', ')', ']', '}', 'Enter', 'Tab']);

function onTyping(e: Event): void {
  const fast = e instanceof KeyboardEvent && BOUNDARY_KEYS.has(e.key);
  scheduleAdvisory(fast ? 60 : TYPING_DEBOUNCE_MS);
}

/**
 * Paste is handled on its own path, for two reasons. It is where the real
 * threat lives -- nobody types an API key, they paste one -- and the pasted
 * text arrives complete, so there is no partial-input problem and no reason
 * to debounce.
 */
function onPaste(e: ClipboardEvent): void {
  if (!settings.enabled) return;
  const pasted = e.clipboardData?.getData('text/plain');
  if (!pasted || pasted.trim().length < 3) return;

  // Warm the cache with the pasted text immediately, then rescan the whole
  // composer once the paste has actually landed in the DOM.
  scanner.scan(pasted);
  const hits = fullScan(pasted).findings;
  if (hits.length) {
    console.info(
      `[prompt-firewall] paste: ${hits.length} finding(s)`,
      hits.map((f) => f.label),
    );
  }
  window.setTimeout(() => advisoryScan(), 0);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  // Attach and show the indicator BEFORE any await. If the service worker is
  // slow to wake or messaging is broken, we still want a visible signal that
  // the content script itself injected -- otherwise a messaging bug and a
  // failed injection look identical from the page.
  gate.attach();
  showReady('armed');

  try {
    const res = await sendToBackground({ type: 'settings:get' });
    settings = res.settings;
  } catch (err) {
    console.warn('[prompt-firewall] settings unavailable, using defaults', err);
  }

  document.addEventListener('input', onTyping, { capture: true });
  document.addEventListener('keyup', onTyping, { capture: true });
  document.addEventListener('paste', onPaste, { capture: true });

  // Highlight rects are viewport coordinates, so anything that moves the
  // text invalidates them. Redraw from the cached map rather than rescanning.
  const redraw = (): void => {
    if (lastMap && lastLive.length) renderHighlights(lastMap, lastLive);
  };
  // Settings are cached in this tab, so a change made on the options page
  // would otherwise not reach an already-open tab until it was reloaded.
  // That is exactly how enabling local AI appeared to do nothing.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings_v1) return;
    const next = changes.settings_v1.newValue as Partial<Settings> | undefined;
    if (!next) return;
    settings = { ...settings, ...next };
    console.info('[prompt-firewall] settings updated', settings);
    scheduleAdvisory(0);
  });

  window.addEventListener('scroll', redraw, { capture: true, passive: true });
  window.addEventListener('resize', redraw, { passive: true });

  // Clicking a settled highlight redacts just that one finding in place.
  setHighlightHandler((f) => {
    const text = adapter.readText();
    const replaced = text.slice(0, f.start) + wrapToken(`${f.kind.toUpperCase()}_1`) + text.slice(f.end);
    if (adapter.writeText(replaced)) advisoryScan();
  });
  // Enter dismisses the routing chip and sends normally -- the chip never
  // intercepts the keystroke.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) dismissChip();
    },
    { capture: true },
  );

  startRehydration(adapter, async () => {
    const r = await sendToBackground({ type: 'vault:get' });
    return r.placeholders;
  });

  window.addEventListener('pagehide', () => {
    gate.detach();
    dismissToast();
    dismissChip();
    hideLive();
    clearHighlights();
  });

  // claude.ai is a single-page app, so the composer frequently does not
  // exist yet at document_idle, and it is replaced again on navigation
  // between conversations. Poll rather than assume: the gate itself resolves
  // the composer lazily on every event, so this only drives the indicator.
  let lastSeen: boolean | null = null;
  const pollComposer = (): void => {
    const found = adapter.getComposer() !== null;
    if (found !== lastSeen) {
      lastSeen = found;
      showReady(found ? 'armed' : 'no-composer');
      console.info(
        `[prompt-firewall] composer ${found ? 'found' : 'NOT FOUND — selectors may be stale'}`,
      );
    }
  };
  pollComposer();
  window.setInterval(pollComposer, 1500);

  console.info('[prompt-firewall] active on', adapter.site);
}

void boot();
