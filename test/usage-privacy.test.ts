/**
 * The usage log is the only thing this extension writes to disk. These tests
 * exist to make "no sensitive value is ever persisted" a property the build
 * enforces, rather than a claim in a README.
 */
import { describe, expect, it } from 'vitest';
import { buildUsageEvent } from '../src/worker/usage-event';
import { scan } from '../src/worker/detectors';
import { redact } from '../src/worker/redact';

const TEXT =
  'Amanda Britfield, SSN 536-22-4891, card 4111 1111 1111 1111, ' +
  'amanda@northlake.org, 540-555-0142, key ' +
  'sk-ant-api03-Xq7Rm2LpVn4Tz8Kw1Yb6Jd3Hs5Gf9Cc0Ae2Bi4Nu7Ok1Pl8Qm3Rt6Uv9Wx2Zy5A';

const r = redact(TEXT, scan(TEXT).findings);
const event = buildUsageEvent({
  host: 'claude.ai',
  lane: 'frontier',
  blocked: false,
  placeholders: r.placeholders,
  text: TEXT,
  scanMs: 1.2,
  now: 1_700_000_000_000,
});
const serialized = JSON.stringify(event);

describe('nothing sensitive reaches disk', () => {
  it('found something to redact in the first place', () => {
    expect(r.placeholders.length).toBeGreaterThan(3);
  });

  it('no detected VALUE appears anywhere in the record', () => {
    for (const p of r.placeholders) {
      expect(serialized, `leaked ${p.kind}`).not.toContain(p.value);
    }
  });

  it('no fragment of the prompt appears in the record', () => {
    for (const word of ['Amanda', 'Britfield', 'northlake', 'sk-ant', '4111', '536-22']) {
      expect(serialized, `leaked "${word}"`).not.toContain(word);
    }
  });

  it('redactions are counts keyed by type, nothing else', () => {
    for (const [kind, count] of Object.entries(event.redactions)) {
      expect(typeof kind).toBe('string');
      expect(typeof count).toBe('number');
    }
    expect(event.redactions.ssn).toBe(1);
    expect(event.redactions.credit_card).toBe(1);
  });

  it('every persisted field is a primitive we can account for', () => {
    // A new field carrying a value would fail here before it ever ships.
    expect(Object.keys(event).sort()).toEqual(
      ['blocked', 'host', 'lane', 'promptTokens', 'redactions', 'scanMs', 'timestamp'].sort(),
    );
  });

  it('token count is a length estimate, not the text', () => {
    expect(event.promptTokens).toBe(Math.ceil(TEXT.length / 4));
  });
});
