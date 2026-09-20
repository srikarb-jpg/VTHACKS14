import { describe, expect, it } from 'vitest';
import { compileRules, parsePolicy, stemFor, unsafePattern } from '../src/shared/policy';
import { detectCustom } from '../src/worker/detectors/custom';
import { IncrementalScanner } from '../src/worker/incremental';
import { redact } from '../src/worker/redact';
import { scan } from '../src/worker/detectors';
import { PLACEHOLDER_PATTERN } from '../src/shared/config';

const policyJson = JSON.stringify({
  schemaVersion: 1,
  name: 'Acme contracts',
  rules: [
    { name: 'contract number', pattern: '\\b[A-Z0-9]{5,6}-\\d{2}-[A-Z]-\\d{4}\\b' },
    { name: 'employee id', pattern: '\\bE-\\d{6}\\b' },
    { name: 'codename', pattern: '\\b(?:Project|Codename) [A-Z][a-z]+\\b', severity: 'low' },
  ],
});

const compiled = () => {
  const r = parsePolicy(policyJson);
  if (!r.ok) throw new Error(r.errors.join());
  return compileRules(r.policy);
};

describe('unsafePattern', () => {
  it.each([
    ['nested repeat', '(a+)+$'],
    ['repeated alternation', '(a|a)*b'],
    ['repeated group with repeat inside', '(\\d{2,3}-)+x'],
    ['lookahead', '(?=x)a'],
    ['lookbehind', '(?<=x)a'],
    ['named group', '(?<n>a)'],
    ['backreference', '(\\d)\\1'],
    ['three open-ended repeats', 'a+b+c+'],
    ['huge bounded repeat', 'a{1,1000}'],
    ['too long', 'a'.repeat(201)],
    ['not a regex', '(unclosed'],
    ['empty', ''],
  ])('refuses %s', (_name, pattern) => {
    expect(unsafePattern(pattern)).not.toBeNull();
  });

  it.each([
    '\\b[A-Z0-9]{5,6}-\\d{2}-[A-Z]-\\d{4}\\b',
    '\\bE-\\d{6}\\b',
    '\\b(?:Project|Codename) [A-Z][a-z]+\\b',
    '\\b[a-z0-9-]+\\.internal\\.[a-z0-9.-]+[a-z]\\b',
    '(?:\\d{3}-)?\\d{4}',
  ])('accepts %s', (pattern) => {
    expect(unsafePattern(pattern)).toBeNull();
  });
});

describe('parsePolicy', () => {
  it('accepts a valid policy, including inside a markdown fence', () => {
    expect(parsePolicy(policyJson).ok).toBe(true);
    expect(parsePolicy('Here you go:\n```json\n' + policyJson + '\n```').ok).toBe(true);
  });

  it('refuses a policy that tries to block sends', () => {
    const r = parsePolicy(JSON.stringify({ schemaVersion: 1, rules: [{ name: 'x', pattern: 'abc', severity: 'block' }] }));
    expect(r.ok).toBe(false);
  });

  it('reports every problem, not just the first', () => {
    const r = parsePolicy(JSON.stringify({ schemaVersion: 1, rules: [{ name: 'a', pattern: '(a+)+' }, { name: 'b', pattern: '(?=b)b' }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(2);
  });

  it.each(['', 'not json', '{"schemaVersion":2,"rules":[]}', '{"schemaVersion":1,"rules":[]}'])('refuses %j', (input) => {
    expect(parsePolicy(input).ok).toBe(false);
  });
});

describe('compileRules', () => {
  it('re-checks stored rules and drops unsafe ones', () => {
    const rules = compileRules({ schemaVersion: 1, rules: [{ name: 'bad', pattern: '(a+)+$' }, { name: 'ok', pattern: '\\bE-\\d{6}\\b' }] });
    expect(rules.map((r) => r.name)).toEqual(['ok']);
  });

  it('tolerates junk from storage', () => {
    expect(compileRules(null)).toEqual([]);
    expect(compileRules({ schemaVersion: 2 } as never)).toEqual([]);
  });
});

describe('detectCustom', () => {
  const text =
    'Our proposal for contract W15P7T-19-D-0042 is due, and the subcontract FA8750-21-C-0113 too. ' +
    'Employee E-448291 needs access. Project Falcon ships soon.';

  it('finds every structured identifier', () => {
    const values = detectCustom(text, compiled()).map((f) => f.value);
    expect(values).toEqual(
      expect.arrayContaining(['W15P7T-19-D-0042', 'FA8750-21-C-0113', 'E-448291', 'Project Falcon']),
    );
  });

  it('finds nothing in ordinary prompts', () => {
    for (const t of ['Explain how binary search works in Python.', 'What is the boiling point of ethanol?']) {
      expect(detectCustom(t, compiled())).toEqual([]);
    }
  });

  it('finds a match once even when windows overlap, and in very large text', () => {
    const big = `${'x '.repeat(4000)}E-123456 ${'y '.repeat(4000)}`;
    expect(detectCustom(big, compiled()).filter((f) => f.value === 'E-123456')).toHaveLength(1);
  });

  it('stays fast on adversarial input even with the patterns allowed', () => {
    const rules = compileRules({ schemaVersion: 1, rules: [{ name: 'greedy', pattern: 'a[a-z]*b[a-z]*c' }] });
    const t0 = performance.now();
    detectCustom('a'.repeat(50_000), rules);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('policy findings through the real pipeline', () => {
  it('redacts to a named, numbered placeholder that rehydration recognises', () => {
    const rules = compiled();
    const text = 'Contract W15P7T-19-D-0042 and FA8750-21-C-0113, plus W15P7T-19-D-0042 again.';
    const r = redact(text, [...scan(text).findings, ...detectCustom(text, rules)], 'medium');
    expect(r.redacted).toBe('Contract [CONTRACT_NUMBER_1] and [CONTRACT_NUMBER_2], plus [CONTRACT_NUMBER_1] again.');
    expect(r.placeholders.every((p) => new RegExp(PLACEHOLDER_PATTERN.source).test(`[${p.token}]`))).toBe(true);
  });

  it('low-severity rules highlight but do not redact on their own', () => {
    const text = 'Project Falcon ships soon.';
    const r = redact(text, detectCustom(text, compiled()), 'medium');
    expect(r.redacted).toBe(text);
  });

  it('works through the incremental scanner cache', () => {
    let rules = compiled();
    const scanner = new IncrementalScanner((t) => [...scan(t).findings, ...detectCustom(t, rules)]);
    const text = 'Employee E-448291 needs access.';
    expect(scanner.scan(text).findings.some((f) => f.kind === 'custom')).toBe(true);
    // Policy removed: the cache must be cleared or stale hits would survive.
    rules = [];
    scanner.clear();
    expect(scanner.scan(text).findings.some((f) => f.kind === 'custom')).toBe(false);
  });
});

describe('stemFor', () => {
  it('makes safe placeholder names', () => {
    expect(stemFor('contract number')).toBe('CONTRACT_NUMBER');
    expect(stemFor('  Employee-ID (staff) ')).toBe('EMPLOYEE_ID_STAFF');
    expect(stemFor('123 thing')).toBe('X_123_THING');
    expect(stemFor('!!!')).toBe('CUSTOM');
  });
});

describe('escape repair', () => {
  // Exactly what the HokieAI agent returned: single backslashes.
  const single = String.raw`{
"schemaVersion": 1,
"name": "contoso-sensitive-formats",
"rules": [
{ "name": "government contract number", "pattern": "\b[A-Z0-9]{5,6}-\d{2}-[A-Z]-\d{4}\b", "severity": "medium", "ignoreCase": true },
{ "name": "employee id", "pattern": "\bE-\d{6}\b", "severity": "medium" },
{ "name": "internal server hostname", "pattern": "\b[a-z0-9.-]+\.internal\.contoso\.net\b", "severity": "medium" },
{ "name": "project codename", "pattern": "\b(?:Project|Codename)\s+[A-Z][a-z]+\b", "severity": "low" }
]
}`;

  it('accepts single-backslash regex escapes, as chat assistants write them', () => {
    const r = parsePolicy(single);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy.rules.map((x) => x.name)).toHaveLength(4);
  });

  it('keeps \\b as a word boundary, not a backspace character', () => {
    const r = parsePolicy(single);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.policy.rules[1]?.pattern).toBe(String.raw`\bE-\d{6}\b`);
    expect(r.policy.rules[1]?.pattern.includes('\u0008')).toBe(false);
  });

  it('gives the same result for correctly double-escaped JSON', () => {
    const doubled = single.replace(/\\/g, '\\\\');
    const a = parsePolicy(single);
    const b = parsePolicy(doubled);
    expect(a.ok && b.ok && JSON.stringify(a.policy)).toBe(a.ok && b.ok ? JSON.stringify(b.policy) : '');
  });

  it('the repaired policy matches what the user meant', () => {
    const r = parsePolicy(single);
    if (!r.ok) throw new Error(r.errors.join());
    const text =
      'Review W15P7T-19-D-0042 for Project Falcon. Ask E-448291 to SSH into db-prod-03.internal.contoso.net. What boils at 78 C, and does version 19-2-1 matter?';
    const values = detectCustom(text, compileRules(r.policy)).map((f) => f.value);
    expect(values).toEqual(
      expect.arrayContaining(['W15P7T-19-D-0042', 'Project Falcon', 'E-448291', 'db-prod-03.internal.contoso.net']),
    );
    expect(values).toHaveLength(4);
  });
});
