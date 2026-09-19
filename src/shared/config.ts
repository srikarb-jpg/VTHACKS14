/**
 * Feature flags and tuned constants. Anything a judge might ask us to justify,
 * or that we might want to switch off live on stage, lives here.
 */

/**
 * The memory audit works end to end but is off: what Claude stores about a
 * person is niche, domain-specific PII that a small on-device model cannot
 * find reliably, and a feature that quietly misses things is worse than none.
 * Kept in the tree, hidden behind this flag.
 */
export const MEMORY_AUDIT_ENABLED = false;

/** Debounce for advisory scans while typing, in milliseconds. */
export const TYPING_DEBOUNCE_MS = 300;

/**
 * Budget for the authoritative scan at submit. Exceeding this means the user
 * perceives a delay on Enter, which breaks the ad-blocker premise. Measured
 * and reported, not assumed.
 */
export const SUBMIT_LATENCY_BUDGET_MS = 100;

/** Sites the content script is allowed to touch. Keep in sync with manifest. */
export const SUPPORTED_HOSTS = ['claude.ai'] as const;

/** Delimiters around placeholder tokens in the outgoing prompt. */
export const PLACEHOLDER_PREFIX = '[';
export const PLACEHOLDER_SUFFIX = ']';

export function wrapToken(token: string): string {
  return `${PLACEHOLDER_PREFIX}${token}${PLACEHOLDER_SUFFIX}`;
}

/** Matches any wrapped placeholder, for hover rehydration in responses. */
export const PLACEHOLDER_PATTERN = /\[([A-Z][A-Z0-9_]*_\d+)\]/g;
