/**
 * The ad-blocker badge. This is the entire ambient UI: a number that goes up.
 *
 * Counts are per tab and per session -- they reset on navigation, exactly
 * like a content blocker's count, because the number means "on this page"
 * and not "since you installed this".
 */
interface Counts {
  redactions: number;
  reroutes: number;
}

const byTab = new Map<number, Counts>();

function render(tabId: number): void {
  const c = byTab.get(tabId);
  const total = (c?.redactions ?? 0) + (c?.reroutes ?? 0);
  void chrome.action.setBadgeText({ tabId, text: total ? String(total) : '' });
  // Brand violet. Keep in sync with --pf-ink in src/shared/theme.css.
  void chrome.action.setBadgeBackgroundColor({ tabId, color: '#5b3fd1' });
}

export function increment(tabId: number, redactions: number, reroutes: number): void {
  const c = byTab.get(tabId) ?? { redactions: 0, reroutes: 0 };
  c.redactions += redactions;
  c.reroutes += reroutes;
  byTab.set(tabId, c);
  render(tabId);
}

export function reset(tabId: number): void {
  byTab.delete(tabId);
  render(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => byTab.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') reset(tabId);
});
