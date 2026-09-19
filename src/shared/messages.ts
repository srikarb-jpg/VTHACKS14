/**
 * THE INTEGRATION SEAM.
 *
 * Every cross-context call in the extension goes through one of these unions.
 * Agreeing on this file is what lets four people work in parallel without
 * blocking each other: implement against the type, wire it up later.
 *
 * Two channels:
 *   content  -> background   ToBackground / FromBackground   (chrome.runtime)
 *   content  -> scanner      ToScanner / FromScanner         (in-process today)
 *
 * Change a shape here and you have changed someone else's code. Say so.
 */
import type { NerSpan, Probe } from './ner';
import type {
  Finding,
  Placeholder,
  RouteDecision,
  ScanResult,
  Settings,
  UsageEvent,
} from './types';

// ---------------------------------------------------------------------------
// content -> scanner
// ---------------------------------------------------------------------------

export type ToScanner =
  | {
      type: 'scan';
      /** Correlates the response. Monotonic per content script instance. */
      id: number;
      text: string;
      /** Advisory scans may skip expensive detectors; submit scans never do. */
      authoritative: boolean;
    }
  | { type: 'reset-cache' };

export type FromScanner = {
  type: 'scan-result';
  id: number;
  result: ScanResult;
};

// ---------------------------------------------------------------------------
// content -> background
// ---------------------------------------------------------------------------

export type ToBackground =
  /** Store the redaction mapping for this tab. Returns nothing useful. */
  | { type: 'vault:put'; placeholders: Placeholder[] }
  /** Look up the real values so the content script can render hover tooltips. */
  | { type: 'vault:get' }
  /** Drop this tab's mappings, e.g. on navigation. */
  | { type: 'vault:clear' }
  /** Append a metadata-only row to the usage log. */
  | { type: 'usage:record'; event: UsageEvent }
  | { type: 'usage:query'; sinceMs: number }
  | { type: 'settings:get' }
  | { type: 'settings:set'; patch: Partial<Settings> }
  /** Bump the ad-blocker badge for this tab. */
  | { type: 'badge:increment'; redactions: number; reroutes: number }
  /** Ask whether this machine can host the model, without downloading it. */
  | { type: 'ner:probe' }
  /** Begin the one-time model download. Resolves when it is usable. */
  | { type: 'ner:load' }
  /** Run detection. Returns [] when the model is not loaded. */
  | { type: 'ner:detect'; texts: string[]; threshold?: number }
  | { type: 'ner:selftest' };

export type FromBackground =
  | { type: 'ner:probe-result'; probe: Probe; loaded: boolean; error: string | null }
  | { type: 'ner:loaded'; ok: boolean; error: string | null }
  | {
      type: 'ner:spans';
      spans: NerSpan[][];
      /** Model time only. */
      inferMs: number;
      /** Model time plus the background->offscreen messaging round trip. */
      roundTripMs: number;
      error: string | null;
    }
  | { type: 'ner:selftest-result'; ms: number; spans: NerSpan[]; provider: string; error: string | null }
  | { type: 'vault:contents'; placeholders: Placeholder[] }
  | { type: 'usage:rows'; events: UsageEvent[] }
  | { type: 'settings:value'; settings: Settings }
  | { type: 'ok' };

/**
 * Narrowing helper for the background's single message listener. Keeps the
 * switch exhaustive without casting at every branch.
 */
export type ResponseFor<M extends ToBackground> = M extends { type: 'ner:probe' }
  ? Extract<FromBackground, { type: 'ner:probe-result' }>
  : M extends { type: 'ner:load' }
    ? Extract<FromBackground, { type: 'ner:loaded' }>
    : M extends { type: 'ner:selftest' }
      ? Extract<FromBackground, { type: 'ner:selftest-result' }>
      : M extends { type: 'ner:detect' }
      ? Extract<FromBackground, { type: 'ner:spans' }>
      : M extends { type: 'vault:get' }
  ? Extract<FromBackground, { type: 'vault:contents' }>
  : M extends { type: 'usage:query' }
    ? Extract<FromBackground, { type: 'usage:rows' }>
    : M extends { type: 'settings:get' | 'settings:set' }
      ? Extract<FromBackground, { type: 'settings:value' }>
      : Extract<FromBackground, { type: 'ok' }>;

/** Typed wrapper over chrome.runtime.sendMessage. Use this, not the raw API. */
export async function sendToBackground<M extends ToBackground>(
  message: M,
): Promise<ResponseFor<M>> {
  return (await chrome.runtime.sendMessage(message)) as ResponseFor<M>;
}

// ---------------------------------------------------------------------------
// UI component contracts
//
// Dev C builds these against dev/harness.html with fake data. Dev A calls them.
// Neither needs the other's code to exist.
// ---------------------------------------------------------------------------

export interface ToastOptions {
  placeholders: Placeholder[];
  /** Restores the original text to the composer. Does not resend. */
  onUndo: () => void;
  onOpenDiff: () => void;
}

export interface DiffOptions {
  original: string;
  redacted: string;
  placeholders: Placeholder[];
  /** Revert a single redaction. The panel stays open. */
  onRevert: (token: string) => void;
  onClose: () => void;
}

export interface BlockPanelOptions {
  findings: Finding[];
  onDismiss: () => void;
}

export interface ChipOptions {
  decision: RouteDecision;
  onAccept: () => void;
  onDismiss: () => void;
}
