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
import { scan } from '../worker/detectors';
import { redact, revertOne } from '../worker/redact';
import { sendToBackground } from '../shared/messages';
import { SUBMIT_LATENCY_BUDGET_MS, TYPING_DEBOUNCE_MS } from '../shared/config';
import type { Placeholder, Settings, UsageEvent } from '../shared/types';
import { ClaudeAdapter } from './adapters/claude';
import { SubmitGate, type GateVerdict } from './gate';
import { route, worthSuggesting } from './router';
import { startRehydration } from './rehydrate';
import { showToast, dismissToast } from './ui/toast';
import { showDiff, closeDiff } from './ui/diff';
import { showBlockPanel } from './ui/cui-block';
import { showChip, dismissChip } from './ui/chip';

const adapter = new ClaudeAdapter();
let settings: Settings = {
  mode: 'autopilot',
  enabled: true,
  searchLaneEnabled: false,
  showRoutingChips: true,
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

function scanNow(text: string) {
  return scan(text);
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

function onTyping(): void {
  window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => {
    if (!settings.enabled || !settings.showRoutingChips) return;
    const text = adapter.readText();
    if (text.trim().length < 8) {
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
  }, TYPING_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const res = await sendToBackground({ type: 'settings:get' });
  settings = res.settings;

  gate.attach();
  document.addEventListener('input', onTyping, { capture: true });
  document.addEventListener('keydown', () => dismissChip(), { capture: true });

  startRehydration(adapter, async () => {
    const r = await sendToBackground({ type: 'vault:get' });
    return r.placeholders;
  });

  window.addEventListener('pagehide', () => {
    gate.detach();
    dismissToast();
    dismissChip();
  });

  console.info('[prompt-firewall] active on', adapter.site);
}

void boot();
