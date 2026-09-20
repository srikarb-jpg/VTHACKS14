/**
 * What the panel and the underlines show, as a pure function of state.
 *
 * This used to be assembled inline in two places -- the typing scan and the
 * late-NER repaint -- and they disagreed: the typing scan built its view from
 * regex findings alone. Any scan that ran AFTER the model had finished (the
 * keyup that follows a paste, a caret move, a click on a row) therefore
 * repainted without the model's findings, and because the text had not
 * changed the model was never re-run to bring them back. Names vanished until
 * the user typed something new, and clicking "Click to replace" made the row
 * disappear and the panel say "Nothing sensitive so far."
 *
 * One builder, used by both paths, so they cannot drift apart again.
 */
import type { Finding } from '../shared/types';
import { resolveOverlaps } from '../worker/detectors';
import { markSettled, type LiveFinding } from '../worker/incremental';
import { isConfirmed } from './confirmed';

export interface LiveViewInput {
  regex: Finding[];
  /** The model's findings, and the exact text they were computed for. */
  ner: Finding[];
  nerFor: string;
  text: string;
  caret: number | null;
  /**
   * Pasted text is complete by definition. Without this, a finding that ends
   * where the paste ends -- pasting a lone key or email -- sits at the caret
   * and stays provisional until the user types.
   */
  settleAll: boolean;
}

export function buildLiveView(i: LiveViewInput): LiveFinding[] {
  // Model findings are offsets into a specific string. For any other string
  // they would underline the wrong words, so stale ones are dropped.
  const ner = i.nerFor === i.text ? i.ner : [];
  const merged = ner.length ? resolveOverlaps([...i.regex, ...ner]) : i.regex;
  return markSettled(merged, i.text, i.caret).map((f) => ({
    ...f,
    settled: f.settled || i.settleAll,
    confirmed: f.severity === 'low' && isConfirmed(f),
  }));
}
