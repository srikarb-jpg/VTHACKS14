/**
 * Turning findings into a redacted prompt.
 *
 * Two properties the spec depends on:
 *
 *  1. Placeholders are TYPED. [EMAIL_1] tells the model it is looking at an
 *     email, so the answer still makes grammatical and logical sense.
 *  2. Placeholders are CONSISTENT. The same value anywhere in the prompt gets
 *     the same token, so the model can reason about who is who.
 *
 * Both fall out of keying the counter on (kind, value) rather than position.
 */
import type { Finding, FindingKind, Placeholder, RedactionResult } from '../shared/types';
import { wrapToken } from '../shared/config';
import { atLeast } from '../shared/types';

const TOKEN_STEM: Record<FindingKind, string> = {
  classification_marking: 'MARKING',
  api_key: 'API_KEY',
  private_key: 'PRIVATE_KEY',
  jwt: 'JWT',
  ssn: 'SSN',
  credit_card: 'CARD',
  bank_account: 'ACCOUNT',
  email: 'EMAIL',
  phone: 'PHONE',
  street_address: 'ADDRESS',
  date_of_birth: 'DOB',
  person: 'PERSON',
  organization: 'ORG',
  location: 'LOCATION',
};

/**
 * Applies redactions for every finding at or above `threshold`. Findings below
 * it are returned untouched so the content script can render them as
 * highlights the user may act on manually.
 */
export function redact(
  text: string,
  findings: Finding[],
  threshold: Finding['severity'] = 'medium',
): RedactionResult {
  const toRedact = findings.filter((f) => atLeast(f.severity, threshold));
  const untouched = findings.filter((f) => !atLeast(f.severity, threshold));

  // (kind, value) -> token, so a repeated value reuses its token.
  const assigned = new Map<string, Placeholder>();
  const counters = new Map<FindingKind, number>();

  function tokenFor(f: Finding): string {
    const key = `${f.kind}\u0000${f.value}`;
    const existing = assigned.get(key);
    if (existing) return existing.token;
    const n = (counters.get(f.kind) ?? 0) + 1;
    counters.set(f.kind, n);
    const token = `${TOKEN_STEM[f.kind]}_${n}`;
    assigned.set(key, { token, kind: f.kind, value: f.value });
    return token;
  }

  // Assign tokens in DOCUMENT order, so the first person in the text is
  // PERSON_1. Splicing happens right-to-left below to keep earlier indices
  // valid, and doing both in one pass numbered them backwards -- the second
  // person in a sentence came out as PERSON_3, which makes the diff read as
  // if something is wrong.
  for (const f of [...toRedact].sort((a, b) => a.start - b.start)) tokenFor(f);

  let redacted = text;
  for (const f of [...toRedact].sort((a, b) => b.start - a.start)) {
    redacted = redacted.slice(0, f.start) + wrapToken(tokenFor(f)) + redacted.slice(f.end);
  }

  return {
    original: text,
    redacted,
    // Insertion order is assignment order, so PERSON_1 precedes PERSON_2.
    placeholders: [...assigned.values()],
    untouched,
  };
}

/** Puts one real value back, used by the diff panel's click-to-revert. */
export function revertOne(redactedText: string, placeholder: Placeholder): string {
  return redactedText.split(wrapToken(placeholder.token)).join(placeholder.value);
}
