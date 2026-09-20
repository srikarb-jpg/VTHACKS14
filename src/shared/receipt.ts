/**
 * The shareable receipt.
 *
 * Built from the usage log, which holds counts by type and nothing else, so a
 * receipt is safe to post by construction. It is also kept that way by a test:
 * the shape below is a whitelist, and adding a field to it is a deliberate act
 * rather than something that can happen by accident.
 */
import { ALL_TIME_MS, KIND_INFO, lastDays, rangeStart, shortDate, summarize } from './stats';
import type { UsageEvent } from './types';

export type ReceiptPeriod = 7 | 30 | 'all';

export interface Receipt {
  product: 'Deadbolt';
  period: string;
  range: string;
  promptsChecked: number;
  itemsKeptOut: number;
  sendsBlocked: number;
  byType: Array<{ type: string; count: number }>;
  note: string;
}

const NOTE = 'Counted on this device. What was typed was never stored or shared.';

export function buildReceipt(
  events: readonly UsageEvent[],
  period: ReceiptPeriod,
  now: number = Date.now(),
): Receipt {
  const scoped = period === 'all' ? events.filter((e) => e.timestamp <= ALL_TIME_MS) : lastDays(events, period, now);
  const s = summarize(scoped);
  const first = scoped[0]?.timestamp;

  return {
    product: 'Deadbolt',
    period: period === 'all' ? 'All time' : `Last ${period} days`,
    range:
      period === 'all'
        ? first
          ? `Since ${shortDate(first)}`
          : 'No activity yet'
        : `${shortDate(rangeStart(period, now))} to ${shortDate(now)}`,
    promptsChecked: s.prompts,
    itemsKeptOut: s.items,
    sendsBlocked: s.blocked,
    byType: s.byKind.map(({ kind, n }) => ({ type: KIND_INFO[kind].label, count: n })),
    note: NOTE,
  };
}

/** Plain text, for pasting into a post or into an assistant that writes one. */
export function receiptText(r: Receipt): string {
  const lines = [
    `${r.product} receipt: ${r.period} (${r.range})`,
    `${r.itemsKeptOut} item${r.itemsKeptOut === 1 ? '' : 's'} kept out of ${r.promptsChecked} prompt${r.promptsChecked === 1 ? '' : 's'}`,
    ...r.byType.map((t) => `- ${t.type}: ${t.count}`),
  ];
  if (r.sendsBlocked > 0) {
    lines.push(`${r.sendsBlocked} send${r.sendsBlocked === 1 ? '' : 's'} blocked (classification markings)`);
  }
  lines.push(r.note);
  return lines.join('\n');
}
