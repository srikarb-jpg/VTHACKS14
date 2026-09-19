import { describe, expect, it } from 'vitest';
import { splitStable, hash } from '../src/worker/chunks';
import { IncrementalScanner, isSettled, markSettled } from '../src/worker/incremental';
import { scan as fullScan } from '../src/worker/detectors';

const detect = (t: string) => fullScan(t).findings;
const mk = () => new IncrementalScanner(detect);

describe('chunking', () => {
  it('splits on sentence ends and newlines', () => {
    const chunks = splitStable('One. Two! Three?\nFour');
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((c) => c.text.trim())).toContain('Four');
  });

  it('does not split decimals, versions or domains', () => {
    const chunks = splitStable('Upgrade to 1.2.3 from example.com today');
    expect(chunks).toHaveLength(1);
  });

  it('chunk offsets reconstruct the original exactly', () => {
    const text = 'First line.\nSecond sentence here. Third one! And a fourth?\n\nTail';
    const chunks = splitStable(text);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
    for (const c of chunks) expect(text.slice(c.start, c.start + c.text.length)).toBe(c.text);
  });

  it('caps very long unpunctuated text into multiple chunks', () => {
    const text = 'word '.repeat(300);
    expect(splitStable(text).length).toBeGreaterThan(1);
  });

  it('hashes are stable and differ on change', () => {
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
  });
});

describe('incremental cache', () => {
  const doc =
    'Hello there. My email is dana@example.com and I need help. ' +
    'The key is sk-ant-api03-Xq7Rm2LpVn4Tz8Kw1Yb6Jd3Hs5Gf9Cc0Ae2Bi4Nu7Ok1Pl8Qm3Rt6Uv9Wx2Zy5A here. ' +
    'Thanks a lot for looking into this issue.';

  it('is all misses on first scan, all hits on an identical rescan', () => {
    const s = mk();
    const first = s.scan(doc);
    expect(first.stats.hits).toBe(0);
    expect(first.stats.misses).toBe(first.stats.chunks);

    const second = s.scan(doc);
    expect(second.stats.misses).toBe(0);
    expect(second.stats.hits).toBe(second.stats.chunks);
  });

  it('appending to the last sentence leaves earlier chunks cached', () => {
    const s = mk();
    s.scan(doc);
    const after = s.scan(doc + ' Please advise.');
    // Some chunks must still hit, or the cache is doing nothing.
    expect(after.stats.hits).toBeGreaterThan(0);
    expect(after.stats.misses).toBeLessThan(after.stats.chunks);
  });

  it('produces the same findings as a full non-incremental scan', () => {
    const s = mk();
    const incremental = s.scan(doc).findings;
    const full = fullScan(doc).findings;
    const norm = (fs: typeof full) =>
      fs.map((f) => `${f.kind}:${f.start}:${f.end}`).sort();
    expect(norm(incremental)).toEqual(norm(full));
  });

  it('finds a match that straddles a chunk boundary', () => {
    // A sentence break placed immediately before an email.
    const text = 'Contact below.\ndana.whitfield@northlake-health.org is the address.';
    const s = mk();
    const kinds = s.scan(text).findings.map((f) => f.kind);
    expect(kinds).toContain('email');
  });

  it('never reports the same span twice', () => {
    const text = 'Line one.\ndana@example.com\nLine three.';
    const s = mk();
    const fs = s.scan(text).findings;
    const keys = fs.map((f) => `${f.start}:${f.end}:${f.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('cuts detector INVOCATIONS, which is the property that matters', () => {
    // Wall time is the wrong assertion for the regex tier -- see the
    // "cost model" block below. The invariant the cache actually guarantees
    // is that the detector runs once per distinct chunk, not once per scan.
    let calls = 0;
    const s = new IncrementalScanner((t) => {
      calls++;
      return detect(t);
    });

    s.scan(doc);
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThan(1);

    s.scan(doc);
    expect(calls).toBe(afterFirst); // identical rescan: zero new work

    s.scan(doc + ' Please advise.');
    // Only the tail is dirty, so a small number of new invocations.
    expect(calls - afterFirst).toBeLessThan(afterFirst);
  });
});

describe('oversized documents', () => {
  it('bypasses the cache rather than thrashing it', () => {
    // More chunks than the cache can hold: every entry would be evicted
    // before reuse, so the cached path is pure overhead.
    const huge = 'Sentence about dana@example.com here. '.repeat(2000);
    const s = mk();
    const r = s.scan(huge);
    expect(r.stats.bypassed).toBe(true);
    expect(s.size).toBe(0); // nothing was cached
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it('bypassed results still match a flat scan', () => {
    const huge = 'Call dana@example.com now. '.repeat(2000);
    const s = mk();
    const a = s.scan(huge).findings.map((f) => `${f.kind}:${f.start}`).sort();
    const b = fullScan(huge).findings.map((f) => `${f.kind}:${f.start}`).sort();
    expect(a).toEqual(b);
  });
});

describe('cost model', () => {
  /**
   * The cache is not free: it hashes each padded chunk and allocates. With
   * regex detectors -- which cost microseconds -- that overhead can EXCEED
   * the detection it avoids, making the incremental path a pessimization.
   *
   * It pays for itself only once a detector is expensive, which is exactly
   * the NER case it was built for. These two tests pin that reasoning down
   * so nobody "optimizes" the cache away, or wrongly claims it speeds up
   * the regex tier.
   */
  const doc = 'Hello there. My email is dana@example.com and I need help. Thanks.';

  it('a slow detector benefits enormously', () => {
    const slow = (t: string) => {
      // ~2ms of busy work, standing in for a transformer forward pass.
      const until = performance.now() + 2;
      while (performance.now() < until);
      return detect(t);
    };
    const s = new IncrementalScanner(slow);
    const cold = s.scan(doc).stats.elapsedMs;
    const warm = s.scan(doc).stats.elapsedMs;
    expect(warm).toBeLessThan(cold / 2);
  });

  it('regex detection alone is already inside the submit budget', () => {
    // The honest baseline: if this stays true, the regex tier never needed
    // the cache, and the cache is there for the model that comes next.
    const big = Array.from({ length: 40 }, (_, i) => `Sentence ${i} about dana${i}@example.com here.`).join(' ');
    const started = performance.now();
    fullScan(big);
    expect(performance.now() - started).toBeLessThan(20);
  });
});

describe('settled vs provisional', () => {
  const emailOf = (t: string) => {
    const f = fullScan(t).findings.find((x) => x.kind === 'email');
    if (!f) throw new Error(`no email found in: ${t}`);
    return f;
  };

  it('a match at the very end of the text is provisional', () => {
    const t = 'write to dana@example.com';
    expect(isSettled(emailOf(t), t, t.length)).toBe(false);
  });

  it('a match followed by a space is settled', () => {
    const t = 'write to dana@example.com soon';
    expect(isSettled(emailOf(t), t, t.length)).toBe(true);
  });

  it('a match the caret sits inside is provisional', () => {
    const t = 'write to dana@example.com soon';
    const f = emailOf(t);
    expect(isSettled(f, t, f.start + 3)).toBe(false);
  });

  it('punctuation terminates a match', () => {
    const t = 'write to dana@example.com, then wait';
    expect(isSettled(emailOf(t), t, t.length)).toBe(true);
  });

  it('markSettled annotates every finding', () => {
    const t = 'mail dana@example.com, key sk-ant-api03-Xq7Rm2LpVn4Tz8Kw1Yb6Jd3Hs5Gf9Cc0Ae2Bi4Nu7Ok1Pl8Qm3Rt6Uv9Wx2Zy5A';
    const marked = markSettled(fullScan(t).findings, t, t.length);
    expect(marked.length).toBeGreaterThan(1);
    expect(marked.every((f) => typeof f.settled === 'boolean')).toBe(true);
    // The trailing key is still being typed, so it is not settled.
    expect(marked.at(-1)?.settled).toBe(false);
  });
});
