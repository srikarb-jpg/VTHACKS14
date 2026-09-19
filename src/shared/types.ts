/**
 * Core domain types. Everything else in the extension is built on these.
 *
 * Severity determines friction, and nothing else. This mapping is the whole
 * product philosophy compressed into one enum, so changing it changes the
 * product:
 *
 *   block  -> cancel the send outright. Classification markings only.
 *   high   -> auto-redact, toast with undo. High-precision detectors only.
 *   medium -> auto-redact, listed in the toast.
 *   low    -> highlight only. Never alters text on its own.
 */
export type Severity = 'block' | 'high' | 'medium' | 'low';

export const SEVERITY_ORDER: readonly Severity[] = ['block', 'high', 'medium', 'low'];

/** True when `a` is at least as severe as `b`. */
export function atLeast(a: Severity, b: Severity): boolean {
  return SEVERITY_ORDER.indexOf(a) <= SEVERITY_ORDER.indexOf(b);
}

/**
 * The kind of thing a detector found. Placeholder names are derived from this,
 * so `api_key` becomes API_KEY_1. Keep these SCREAMING_SNAKE-able.
 */
export type FindingKind =
  // block
  | 'classification_marking'
  // high
  | 'api_key'
  | 'private_key'
  | 'jwt'
  | 'ssn'
  | 'credit_card'
  | 'bank_account'
  // medium
  | 'email'
  | 'phone'
  | 'street_address'
  | 'date_of_birth'
  // low
  | 'person'
  | 'organization'
  | 'location';

/** One detection in a span of text. `start`/`end` index into the scanned string. */
export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** Human-readable label for the toast and diff, e.g. "OpenAI API key". */
  label: string;
  start: number;
  end: number;
  /** The matched text. Never leaves the device, never written to the usage log. */
  value: string;
  /** Which detector produced this, for debugging and the eval harness. */
  detector: string;
  /**
   * Model confidence in [0,1], for detectors that produce one. Absent for
   * regex, which is deterministic -- a pattern either matched or it did not.
   */
  score?: number;
}

/** A redaction that was applied: real value <-> placeholder token. */
export interface Placeholder {
  /** e.g. "API_KEY_1" — bare, without delimiters. */
  token: string;
  kind: FindingKind;
  value: string;
}

export interface ScanResult {
  findings: Finding[];
  /** Highest severity present, or null when the text is clean. */
  maxSeverity: Severity | null;
  /** Wall-clock milliseconds the scan took. Drives the latency budget metric. */
  elapsedMs: number;
}

/** The output of applying redactions to a prompt. */
export interface RedactionResult {
  original: string;
  redacted: string;
  placeholders: Placeholder[];
  /** Findings that were left alone (low tier). Rendered as highlights. */
  untouched: Finding[];
}

export type Lane = 'searchable' | 'cached' | 'local-capable' | 'frontier';

export interface RouteDecision {
  lane: Lane;
  confidence: number;
  /** Short human-readable justification shown in the chip. */
  reason: string;
  source: 'rules' | 'classifier';
}

export type Mode = 'watch' | 'autopilot' | 'strict';

export interface Settings {
  mode: Mode;
  /** Master switch; when false the content script observes but never acts. */
  enabled: boolean;
  searchLaneEnabled: boolean;
  showRoutingChips: boolean;
  /**
   * Local AI detection. Off by default because enabling it downloads ~183 MB
   * of model weights, which should be a deliberate choice rather than a
   * surprise on someone's tethered connection.
   */
  nerEnabled: boolean;
  /**
   * Opt in to redacting model-found names WITHOUT confirming each one.
   *
   * Off by default, which keeps design principle 3 intact: low-precision
   * detectors never alter text on their own. By default a name is
   * highlighted and redacted only once the user clicks to confirm it.
   * Turning this on trades that safety for fewer clicks.
   */
  autoRedactNames: boolean;
  /** Minimum model confidence for a name to be redacted rather than shown. */
  nerAutoRedactMinScore: number;
}

/**
 * One row in the usage log. Deliberately contains no prompt text and no
 * detected values — only shapes and counts. This is what makes the dashboard
 * safe to keep on disk.
 */
export interface UsageEvent {
  timestamp: number;
  host: string;
  lane: Lane;
  blocked: boolean;
  /** Count of redactions by severity. Types only, never values. */
  redactions: Partial<Record<FindingKind, number>>;
  promptTokens: number;
  scanMs: number;
}
