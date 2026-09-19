/**
 * The placeholder vault.
 *
 * In memory, keyed per tab, never written to disk. The spec's reasoning is
 * worth keeping in front of us: persisting the mapping would mean a crash
 * leaks the very values we redacted, so we would rather a crash lose the
 * mapping than store it.
 *
 * Consequence to know before the demo: an MV3 service worker is terminated
 * after roughly 30 seconds idle, which clears this. The redaction itself is
 * unaffected -- only the ability to hover a placeholder and see the original.
 * That is the correct trade, but do not leave the demo idling between
 * redacting and hovering.
 */
import type { Placeholder } from '../shared/types';

const byTab = new Map<number, Placeholder[]>();

export function put(tabId: number, placeholders: Placeholder[]): void {
  const existing = byTab.get(tabId) ?? [];
  const merged = new Map(existing.map((p) => [p.token, p]));
  for (const p of placeholders) merged.set(p.token, p);
  byTab.set(tabId, [...merged.values()]);
}

export function get(tabId: number): Placeholder[] {
  return byTab.get(tabId) ?? [];
}

export function clear(tabId: number): void {
  byTab.delete(tabId);
}

chrome.tabs.onRemoved.addListener(clear);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // A navigation means a new conversation context; old mappings are stale.
  if (info.status === 'loading') clear(tabId);
});
