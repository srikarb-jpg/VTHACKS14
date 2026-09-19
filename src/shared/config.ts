/**
 * Feature flags and tuned constants. Anything a judge might ask us to justify,
 * or that we might want to switch off live on stage, lives here.
 */

/**
 * The search lane makes an outbound call to a third-party search API. That is
 * defensible (the query is rewritten and scrubbed first) but it weakens the
 * "nothing leaves the device" claim, which is our strongest answer in Q&A.
 * Ships off. Toggle deliberately if we demo it at all.
 */
export const SEARCH_LANE_ENABLED = false;

/** Debounce for advisory scans while typing, in milliseconds. */
export const TYPING_DEBOUNCE_MS = 300;

/**
 * Budget for the authoritative scan at submit. Exceeding this means the user
 * perceives a delay on Enter, which breaks the ad-blocker premise. Measured
 * and reported, not assumed.
 */
export const SUBMIT_LATENCY_BUDGET_MS = 100;

/** Below this the router escalates a lane rather than downgrading it. */
export const ROUTER_CONFIDENCE_THRESHOLD = 0.7;

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
