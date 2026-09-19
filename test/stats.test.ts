import { describe, expect, it } from 'vitest';
import { DAY_MS, formatCount, lastDays, rangeStart, summarize, today, within } from '../src/shared/stats';
import type { UsageEvent } from '../src/shared/types';

const ev = (over: Partial<UsageEvent> = {}): UsageEvent => ({
  timestamp: 1_000,
  host: 'claude.ai',
  lane: 'frontier',
  blocked: false,
  redactions: {},
  promptTokens: 100,
  scanMs: 1,
  ...over,
});

describe('summarize', () => {
  it('counts prompts, items and blocked sends', () => {
    const s = summarize([
      ev({ redactions: { email: 2, api_key: 1 } }),
      ev({ redactions: { email: 1 } }),
      ev({ blocked: true }),
      ev(),
    ]);
    expect(s.prompts).toBe(4);
    expect(s.items).toBe(4);
    expect(s.blocked).toBe(1);
  });

  it('ranks categories by count, largest first', () => {
    const s = summarize([
      ev({ redactions: { email: 3, api_key: 1 } }),
      ev({ redactions: { phone: 2, email: 1 } }),
    ]);
    expect(s.byKind).toEqual([
      { kind: 'email', n: 4 },
      { kind: 'phone', n: 2 },
      { kind: 'api_key', n: 1 },
    ]);
  });

  it('is empty and zero for an empty log', () => {
    const s = summarize([]);
    expect(s).toMatchObject({ prompts: 0, items: 0, blocked: 0 });
    expect(s.byKind).toEqual([]);
  });
});

describe('time windows', () => {
  const now = new Date(2026, 8, 19, 15, 0, 0).getTime();

  it('within() keeps only events inside the window', () => {
    const rows = [ev({ timestamp: now - 1 }), ev({ timestamp: now - 8 * DAY_MS })];
    expect(within(rows, 7 * DAY_MS, now)).toHaveLength(1);
  });

  it('lastDays() counts calendar days, so "7 days" is today plus six', () => {
    const rows = [
      ev({ timestamp: new Date(2026, 8, 13, 0, 1).getTime() }), // Sep 13: first day of the window
      ev({ timestamp: new Date(2026, 8, 12, 23, 59).getTime() }), // Sep 12: just outside
    ];
    expect(lastDays(rows, 7, now)).toHaveLength(1);
    expect(new Date(rangeStart(7, now)).getDate()).toBe(13);
    expect(new Date(rangeStart(30, now)).getMonth()).toBe(7); // August
    expect(new Date(rangeStart(30, now)).getDate()).toBe(21);
  });

  it('today() starts at local midnight, not 24 hours ago', () => {
    const rows = [
      ev({ timestamp: new Date(2026, 8, 19, 0, 30).getTime() }),
      ev({ timestamp: new Date(2026, 8, 18, 23, 59).getTime() }),
    ];
    expect(today(rows, now)).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('formats large counts with separators', () => {
    expect(formatCount(1208)).toBe('1,208');
    expect(formatCount(87)).toBe('87');
  });
});
