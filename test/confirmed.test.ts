import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyConfirmations,
  clearConfirmed,
  isConfirmed,
  toggleConfirmed,
} from '../src/content/confirmed';
import { nerSpansToFindings } from '../src/worker/ner-map';
import { redact } from '../src/worker/redact';
import { scan } from '../src/worker/detectors';

const TEXT = 'Amanda Britfield was my manager at Microsoft. Amanda Britfield left in 2024.';
const SPANS = [
  { start: 0, end: 16, label: 'person', score: 0.94, text: 'Amanda Britfield' },
  { start: 35, end: 44, label: 'organization', score: 0.62, text: 'Microsoft' },
  { start: 45, end: 61, label: 'person', score: 0.91, text: 'Amanda Britfield' },
];
const NO_AUTO = { enabled: false, minScore: 0.7 };

beforeEach(clearConfirmed);

describe('confirm to redact', () => {
  it('nothing from the model is redactable until confirmed', () => {
    const fs = applyConfirmations(nerSpansToFindings(SPANS, TEXT), NO_AUTO);
    expect(fs.every((f) => f.severity === 'low')).toBe(true);
    expect(redact(TEXT, fs, 'medium').redacted).toBe(TEXT);
  });

  it('confirming one mention confirms every mention of the same value', () => {
    const fs = nerSpansToFindings(SPANS, TEXT);
    toggleConfirmed(fs[0]!);
    const applied = applyConfirmations(fs, NO_AUTO);
    const people = applied.filter((f) => f.value === 'Amanda Britfield');
    expect(people).toHaveLength(2);
    expect(people.every((f) => f.severity === 'medium')).toBe(true);
  });

  it('a confirmed name is replaced on send, consistently', () => {
    const fs = nerSpansToFindings(SPANS, TEXT);
    toggleConfirmed(fs[0]!);
    const r = redact(TEXT, applyConfirmations(fs, NO_AUTO), 'medium');
    expect(r.redacted.match(/\[PERSON_1\]/g)).toHaveLength(2);
    expect(r.redacted).not.toContain('Amanda Britfield');
    // Unconfirmed org is untouched.
    expect(r.redacted).toContain('Microsoft');
  });

  it('toggling twice returns it to highlight-only', () => {
    const fs = nerSpansToFindings(SPANS, TEXT);
    expect(toggleConfirmed(fs[0]!)).toBe(true);
    expect(toggleConfirmed(fs[0]!)).toBe(false);
    expect(isConfirmed(fs[0]!)).toBe(false);
    expect(applyConfirmations(fs, NO_AUTO).every((f) => f.severity === 'low')).toBe(true);
  });

  it('confirmation is case-insensitive on the value', () => {
    const fs = nerSpansToFindings(SPANS, TEXT);
    toggleConfirmed({ ...fs[0]!, value: 'amanda britfield' });
    expect(isConfirmed(fs[0]!)).toBe(true);
  });

  it('regex findings are never gated on confirmation', () => {
    const t = 'mail dana@example.com';
    const fs = applyConfirmations(scan(t).findings, NO_AUTO);
    expect(fs.find((f) => f.kind === 'email')!.severity).toBe('medium');
    expect(redact(t, fs, 'medium').redacted).toContain('[EMAIL_1]');
  });

  it('opting in to auto promotes by score without any click', () => {
    const fs = applyConfirmations(nerSpansToFindings(SPANS, TEXT), {
      enabled: true,
      minScore: 0.7,
    });
    expect(fs.filter((f) => f.value === 'Amanda Britfield').every((f) => f.severity === 'medium'))
      .toBe(true);
    // Still below threshold, so still advisory.
    expect(fs.find((f) => f.value === 'Microsoft')!.severity).toBe('low');
  });
});
