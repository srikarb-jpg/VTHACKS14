import { describe, expect, it } from 'vitest';
import { buildReceipt, receiptText } from '../src/shared/receipt';
import type { UsageEvent } from '../src/shared/types';

const NOW = new Date('2026-09-19T15:00:00').getTime();
const day = 24 * 60 * 60 * 1000;

const ev = (ageDays: number, redactions: UsageEvent['redactions'], blocked = false): UsageEvent => ({
  timestamp: NOW - ageDays * day,
  host: 'claude.ai',
  lane: 'frontier',
  blocked,
  redactions,
  promptTokens: 40,
  scanMs: 2,
});

const events = [ev(1, { email: 2, api_key: 1 }), ev(2, { email: 1 }), ev(20, { ssn: 1 }), ev(3, {}, true)];

describe('receipt', () => {
  it('counts the chosen window only', () => {
    const r = buildReceipt(events, 7, NOW);
    expect(r.itemsKeptOut).toBe(4);
    expect(r.promptsChecked).toBe(3);
    expect(r.sendsBlocked).toBe(1);
    expect(buildReceipt(events, 30, NOW).itemsKeptOut).toBe(5);
  });

  it('exposes only counts and labels -- the shape is a whitelist', () => {
    const r = buildReceipt(events, 'all', NOW);
    expect(Object.keys(r).sort()).toEqual(
      ['byType', 'itemsKeptOut', 'note', 'period', 'product', 'promptsChecked', 'range', 'sendsBlocked'].sort(),
    );
    for (const t of r.byType) expect(Object.keys(t).sort()).toEqual(['count', 'type']);
  });

  it('reads sensibly as text, including the empty case', () => {
    const t = receiptText(buildReceipt(events, 7, NOW));
    expect(t).toContain('4 items kept out of 3 prompts');
    expect(t).toContain('1 send blocked');
    expect(receiptText(buildReceipt([], 7, NOW))).toContain('0 items kept out of 0 prompts');
  });
});
