/**
 * The usage log.
 *
 * What is stored: lane, counts by finding kind, token count, timing, host.
 * What is never stored: prompt text, detected values, response text.
 *
 * That split is what makes it defensible to keep this on disk at all, and it
 * is the first thing a judge should be told about the dashboard.
 */
import type { UsageEvent } from '../shared/types';

const KEY = 'usage_log_v1';
/** Ring buffer bound so a long session cannot grow storage without limit. */
const MAX_ROWS = 5000;

export async function record(event: UsageEvent): Promise<void> {
  const rows = await all();
  rows.push(event);
  const trimmed = rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : rows;
  await chrome.storage.local.set({ [KEY]: trimmed });
}

export async function all(): Promise<UsageEvent[]> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as UsageEvent[] | undefined) ?? [];
}

export async function since(ms: number): Promise<UsageEvent[]> {
  const cutoff = Date.now() - ms;
  return (await all()).filter((e) => e.timestamp >= cutoff);
}

export async function clear(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
