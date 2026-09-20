/**
 * Contact details. Medium tier: auto-redacted and listed in the toast, but
 * not treated as an emergency. These patterns are looser than the high tier
 * on purpose -- an over-redacted phone number costs the user one click, and
 * the diff makes that click obvious.
 */
import type { Finding } from '../../shared/types';

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** North American and common international shapes, requiring a separator or +. */
const PHONE = /(?:\+\d{1,3}[ .\-\u2010-\u2015\u2212]*)?(?:\(\d{3}\)|\b\d{3})[ .\-\u2010-\u2015\u2212]+\d{3}[ .\-\u2010-\u2015\u2212]+\d{4}\b/g;

const STREET_ADDRESS =
  /\b\d{1,6}\s+(?:[A-Z][A-Za-z.]*\s+){0,3}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way|Terrace|Ter|Place|Pl)\b\.?/g;

const DOB =
  /\b(?:DOB|D\.O\.B\.|date of birth)\s*[:=-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})/gi;

interface ContactRule {
  pattern: RegExp;
  kind: 'email' | 'phone' | 'street_address' | 'date_of_birth';
  label: string;
  detector: string;
}

const RULES: ContactRule[] = [
  { pattern: EMAIL, kind: 'email', label: 'Email address', detector: 'contact.email' },
  { pattern: PHONE, kind: 'phone', label: 'Phone number', detector: 'contact.phone' },
  { pattern: STREET_ADDRESS, kind: 'street_address', label: 'Street address', detector: 'contact.address' },
  { pattern: DOB, kind: 'date_of_birth', label: 'Date of birth', detector: 'contact.dob' },
];

export function detectContact(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const m of text.matchAll(rule.pattern)) {
      if (m.index === undefined) continue;
      // DOB captures the date itself; redact that rather than the "DOB:" label.
      const whole = m[0];
      const capture = m[1];
      const value = capture ?? whole;
      const start = capture === undefined ? m.index : m.index + whole.indexOf(capture);
      findings.push({
        kind: rule.kind,
        severity: 'medium',
        label: rule.label,
        start,
        end: start + value.length,
        value,
        detector: rule.detector,
      });
    }
  }
  return findings;
}
