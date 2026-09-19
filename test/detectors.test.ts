import { describe, expect, it } from 'vitest';
import { scan } from '../src/worker/detectors';
import { luhn } from '../src/worker/detectors/identifiers';
import { redact, revertOne } from '../src/worker/redact';
import { NEGATIVES, POSITIVES } from './fixtures/prompts';

const kinds = (text: string) => new Set(scan(text).findings.map((f) => f.kind));

describe('positives', () => {
  for (const c of POSITIVES) {
    it(c.name, () => {
      const found = kinds(c.text);
      for (const k of c.expect) expect(found, `missing ${k}`).toContain(k);
    });
  }
});

describe('negatives (false-positive guards)', () => {
  for (const c of NEGATIVES) {
    it(c.name, () => {
      const found = kinds(c.text);
      for (const k of c.forbid ?? []) expect(found, `false positive: ${k}`).not.toContain(k);
    });
  }
});

describe('luhn', () => {
  it('accepts known-good test numbers', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('5500 0000 0000 0004')).toBe(true);
  });
  it('rejects a bad checksum', () => {
    expect(luhn('4111111111111112')).toBe(false);
  });
});

describe('redaction', () => {
  it('assigns typed placeholders', () => {
    const text = 'Email dana@example.com about the invoice.';
    const r = redact(text, scan(text).findings);
    expect(r.redacted).toContain('[EMAIL_1]');
    expect(r.redacted).not.toContain('dana@example.com');
  });

  it('reuses one token for a repeated value', () => {
    const text = 'Ping dana@example.com, then cc dana@example.com on the reply.';
    const r = redact(text, scan(text).findings);
    expect(r.placeholders).toHaveLength(1);
    expect(r.redacted.match(/\[EMAIL_1\]/g)).toHaveLength(2);
  });

  it('numbers distinct values separately', () => {
    const text = 'Loop in dana@example.com and sam@example.com.';
    const r = redact(text, scan(text).findings);
    expect(r.redacted).toContain('[EMAIL_1]');
    expect(r.redacted).toContain('[EMAIL_2]');
  });

  it('leaves low-tier findings untouched', () => {
    const text = 'Contact dana@example.com';
    const r = redact(text, scan(text).findings, 'high');
    expect(r.redacted).toBe(text);
    expect(r.untouched.map((f) => f.kind)).toContain('email');
  });

  it('round-trips through revert', () => {
    const text = 'Key sk-ant-api03-Xq7Rm2LpVn4Tz8Kw1Yb6Jd3Hs5Gf9Cc0Ae2Bi4Nu7Ok1Pl8Qm3Rt6Uv9Wx2Zy5A is live.';
    const r = redact(text, scan(text).findings);
    let restored = r.redacted;
    for (const p of r.placeholders) restored = revertOne(restored, p);
    expect(restored).toBe(text);
  });

  it('prefers the more severe finding when spans overlap', () => {
    const text = 'api_key = "dana@example.com"';
    const found = [...kinds(text)];
    expect(found).toContain('api_key');
    expect(found).not.toContain('email');
  });
});

describe('latency budget', () => {
  it('scans a long prompt well under the submit budget', () => {
    const long = POSITIVES.map((c) => c.text).join('\n\n').repeat(20);
    const started = performance.now();
    scan(long);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
