/**
 * Building the one record that touches disk.
 *
 * Extracted into a pure function specifically so it can be tested. The
 * dashboard is only defensible because this record contains no prompt text
 * and no detected values -- and that is a property worth enforcing in CI
 * rather than maintaining by care. If someone later adds a field here that
 * carries a value, the test beside this file fails.
 */
import type { FindingKind, Lane, Placeholder, UsageEvent } from '../shared/types';

/** Four characters per token is the usual rule of thumb. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

export function buildUsageEvent(input: {
  host: string;
  lane: Lane;
  blocked: boolean;
  placeholders: Placeholder[];
  text: string;
  scanMs: number;
  now?: number;
}): UsageEvent {
  const redactions: Partial<Record<FindingKind, number>> = {};
  for (const p of input.placeholders) {
    redactions[p.kind] = (redactions[p.kind] ?? 0) + 1;
  }
  return {
    timestamp: input.now ?? Date.now(),
    host: input.host,
    lane: input.lane,
    blocked: input.blocked,
    // Counts by type. Never the values, and never the tokens either -- a
    // token is not sensitive on its own, but pairing it with a timestamp
    // and a count starts to describe the prompt.
    redactions,
    promptTokens: estimateTokens(input.text),
    scanMs: input.scanMs,
  };
}
