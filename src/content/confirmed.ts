/**
 * User confirmations for low-precision findings.
 *
 * The model's findings never rewrite the prompt on their own -- the user
 * clicks to confirm each one. Confirming does NOT edit the composer: doing
 * that mid-typing would move the caret and risks desyncing ProseMirror's
 * document model. Instead a confirmation is remembered and applied at send,
 * alongside every other redaction.
 *
 * Keyed on (kind, value) rather than position, so confirming one mention of
 * a name confirms every mention of it -- including ones typed later, which
 * is what the user means by clicking it.
 */
import type { Finding } from '../shared/types';

const confirmed = new Set<string>();

const keyOf = (f: Finding): string => `${f.kind}\u0000${f.value.toLowerCase()}`;

export function isConfirmed(f: Finding): boolean {
  return confirmed.has(keyOf(f));
}

/** Returns the new state. */
export function toggleConfirmed(f: Finding): boolean {
  const key = keyOf(f);
  if (confirmed.has(key)) {
    confirmed.delete(key);
    return false;
  }
  confirmed.add(key);
  return true;
}

export function confirmedCount(): number {
  return confirmed.size;
}

export function clearConfirmed(): void {
  confirmed.clear();
}

/**
 * Raise confirmed low-tier findings into the redactable tier.
 *
 * `autoConfident` additionally promotes anything the model scored above the
 * threshold, for users who opt out of confirming each one.
 */
export function applyConfirmations(
  findings: Finding[],
  autoConfident: { enabled: boolean; minScore: number },
): Finding[] {
  return findings.map((f) => {
    if (f.severity !== 'low') return f;
    const auto = autoConfident.enabled && (f.score ?? 0) >= autoConfident.minScore;
    return auto || isConfirmed(f) ? { ...f, severity: 'medium' as const } : f;
  });
}
