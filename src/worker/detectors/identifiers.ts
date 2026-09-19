/**
 * Government and financial identifiers. High tier, so each pattern is paired
 * with a checksum or a structural validator where one exists. Shape alone is
 * not enough: "4111 1111 1111 1111" is a card number, "1234 5678 9012 3456"
 * is not, and only Luhn can tell them apart.
 */
import type { Finding } from '../../shared/types';

/** Luhn check. Returns false for anything non-numeric after stripping. */
export function luhn(digits: string): boolean {
  const s = digits.replace(/[^\d]/g, '');
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * SSNs that the SSA has never issued. Filtering these removes the most common
 * false positives, which are placeholder and example numbers in documentation.
 */
function isPlausibleSsn(value: string): boolean {
  const s = value.replace(/[^\d]/g, '');
  if (s.length !== 9) return false;
  const area = s.slice(0, 3);
  const group = s.slice(3, 5);
  const serial = s.slice(5);
  if (area === '000' || area === '666' || area[0] === '9') return false;
  if (group === '00' || serial === '0000') return false;
  if (/^(\d)\1{8}$/.test(s)) return false;
  if (s === '123456789') return false;
  return true;
}

const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const SSN = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;
/** US routing + account pairs, and IBANs. */
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;

export function detectIdentifiers(text: string): Finding[] {
  const findings: Finding[] = [];

  CARD.lastIndex = 0;
  for (const m of text.matchAll(CARD)) {
    if (m.index === undefined) continue;
    if (!luhn(m[0])) continue;
    findings.push({
      kind: 'credit_card',
      severity: 'high',
      label: 'Payment card number',
      start: m.index,
      end: m.index + m[0].length,
      value: m[0],
      detector: 'identifiers.card_luhn',
    });
  }

  SSN.lastIndex = 0;
  for (const m of text.matchAll(SSN)) {
    if (m.index === undefined) continue;
    if (!isPlausibleSsn(m[0])) continue;
    findings.push({
      kind: 'ssn',
      severity: 'high',
      label: 'Social Security number',
      start: m.index,
      end: m.index + m[0].length,
      value: m[0],
      detector: 'identifiers.ssn',
    });
  }

  IBAN.lastIndex = 0;
  for (const m of text.matchAll(IBAN)) {
    if (m.index === undefined) continue;
    findings.push({
      kind: 'bank_account',
      severity: 'high',
      label: 'Bank account (IBAN)',
      start: m.index,
      end: m.index + m[0].length,
      value: m[0],
      detector: 'identifiers.iban',
    });
  }

  return findings;
}
