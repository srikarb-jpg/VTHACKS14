/**
 * Aggregation for the popup and the dashboard.
 *
 * Pure functions over the usage log, so they can be tested without a browser.
 * Everything here works from counts and labels only -- the usage log never
 * held prompt text or detected values, and nothing in this file can invent
 * them.
 */
import type { FindingKind, UsageEvent } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Larger than any real age, so "since" returns every row. Survives JSON. */
export const ALL_TIME_MS = Number.MAX_SAFE_INTEGER;

export type Tier = 'block' | 'high' | 'medium' | 'low';

export interface KindInfo {
  /** Full name, for lists. */
  label: string;
  /** Short name, for chips. */
  short: string;
  tier: Tier;
}

/** Plain-language names. Users should never see `credit_card`. */
export const KIND_INFO: Record<FindingKind, KindInfo> = {
  classification_marking: { label: 'Classification markings', short: 'Markings', tier: 'block' },
  api_key: { label: 'API keys and tokens', short: 'API keys', tier: 'high' },
  private_key: { label: 'Private keys', short: 'Private keys', tier: 'high' },
  jwt: { label: 'Login tokens', short: 'Login tokens', tier: 'high' },
  ssn: { label: 'Social Security numbers', short: 'SSNs', tier: 'high' },
  credit_card: { label: 'Card numbers', short: 'Cards', tier: 'high' },
  bank_account: { label: 'Bank accounts', short: 'Bank accounts', tier: 'high' },
  email: { label: 'Email addresses', short: 'Emails', tier: 'medium' },
  phone: { label: 'Phone numbers', short: 'Phones', tier: 'medium' },
  street_address: { label: 'Street addresses', short: 'Addresses', tier: 'medium' },
  date_of_birth: { label: 'Dates of birth', short: 'Birthdates', tier: 'medium' },
  person: { label: 'Names', short: 'Names', tier: 'low' },
  organization: { label: 'Organizations', short: 'Orgs', tier: 'low' },
  location: { label: 'Places', short: 'Places', tier: 'low' },
  custom: { label: 'Custom policy rules', short: 'Custom', tier: 'medium' },
};

export interface Summary {
  /** Prompts checked, whether or not anything was found. */
  prompts: number;
  /** Items redacted before sending. */
  items: number;
  /** Sends that were cancelled outright (classification markings). */
  blocked: number;
  /** Redactions by kind, largest first. */
  byKind: Array<{ kind: FindingKind; n: number }>;
}

export function summarize(events: readonly UsageEvent[]): Summary {
  let items = 0;
  let blocked = 0;
  const kinds = new Map<FindingKind, number>();

  for (const e of events) {
    if (e.blocked) {
      blocked += 1;
      continue;
    }
    for (const [kind, n] of Object.entries(e.redactions) as Array<[FindingKind, number | undefined]>) {
      const count = n ?? 0;
      items += count;
      kinds.set(kind, (kinds.get(kind) ?? 0) + count);
    }
  }

  return {
    prompts: events.length,
    items,
    blocked,
    byKind: [...kinds.entries()]
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => ({ kind, n }))
      .sort((a, b) => b.n - a.n),
  };
}

/** Events newer than `ms` before `now`. */
export function within(events: readonly UsageEvent[], ms: number, now: number = Date.now()): UsageEvent[] {
  const cutoff = now - ms;
  return events.filter((e) => e.timestamp >= cutoff);
}

/**
 * Local midnight at the start of the window that ends today and is `days`
 * calendar days long. `days = 1` is today, `7` is today and the six days
 * before it. Calendar days, so a label like "Sep 13 to Sep 19" is exactly
 * what was counted.
 */
export function rangeStart(days: number, now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

/** Events in the last `days` calendar days, including today. */
export function lastDays(events: readonly UsageEvent[], days: number, now: number = Date.now()): UsageEvent[] {
  const from = rangeStart(days, now);
  return events.filter((e) => e.timestamp >= from);
}

/** Events since local midnight. */
export function today(events: readonly UsageEvent[], now: number = Date.now()): UsageEvent[] {
  return lastDays(events, 1, now);
}

/** 1208 -> "1,208". */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** "Sep 13". */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
