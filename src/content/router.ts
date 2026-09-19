/**
 * Rules-based router.
 *
 * The spec's embedding classifier is cut for time; this rules layer was
 * always going to run first anyway, and it is the half that is explainable
 * on stage. Two properties from the spec survive intact and matter more than
 * accuracy:
 *
 *   - Escalate on uncertainty, never downgrade. Anything we are not sure
 *     about goes to 'frontier', which is the lane the user already chose by
 *     being on this site. The cost of a wrong guess is therefore zero.
 *   - The router never blocks Enter. It returns a decision; the caller
 *     renders a dismissible chip and sends regardless.
 */
import type { RouteDecision } from '../shared/types';
import { ROUTER_CONFIDENCE_THRESHOLD } from '../shared/config';

const LOOKUP_OPENERS =
  /^\s*(?:what(?:'s| is| are| was| were)|who(?:'s| is| was)|when (?:is|was|did|does)|where (?:is|are|was)|how (?:many|much|old|tall|far|long))\b/i;

const DEFINITION = /^\s*(?:define|definition of|what does .{1,40} mean)\b/i;

const CONVERSION =
  /\b\d+(?:\.\d+)?\s*(?:kg|lb|lbs|km|mi|miles|cm|in|inches|ft|feet|c|f|celsius|fahrenheit|usd|eur|gbp)\b.*\b(?:to|in)\b/i;

const REASONING_MARKERS =
  /\b(?:write|refactor|debug|implement|design|explain why|step by step|analyze|compare and|draft|generate|code|function|class|algorithm|essay|strategy)\b/i;

const REWRITE_MARKERS =
  /\b(?:rewrite|rephrase|shorten|summarize|summarise|tighten|make (?:it|this) (?:shorter|clearer|formal|casual)|fix the grammar|proofread)\b/i;

export function route(text: string): RouteDecision {
  const t = text.trim();
  const words = t.split(/\s+/).length;

  // Reasoning markers win outright: these are the expensive errors to get
  // wrong, so we check them before anything that could downgrade the lane.
  if (REASONING_MARKERS.test(t)) {
    return { lane: 'frontier', confidence: 0.9, reason: 'Needs reasoning', source: 'rules' };
  }

  if (CONVERSION.test(t)) {
    return {
      lane: 'searchable',
      confidence: 0.95,
      reason: 'A unit conversion — a search would answer this instantly',
      source: 'rules',
    };
  }

  if (DEFINITION.test(t) && words < 20) {
    return {
      lane: 'searchable',
      confidence: 0.9,
      reason: 'A definition lookup — search handles this',
      source: 'rules',
    };
  }

  if (LOOKUP_OPENERS.test(t) && words < 25) {
    return {
      lane: 'searchable',
      confidence: 0.75,
      reason: 'Looks like a factual lookup',
      source: 'rules',
    };
  }

  if (REWRITE_MARKERS.test(t) && words < 120) {
    return {
      lane: 'local-capable',
      confidence: 0.8,
      reason: 'A short rewrite — a small local model could do this',
      source: 'rules',
    };
  }

  return { lane: 'frontier', confidence: 1, reason: 'Passed through', source: 'rules' };
}

/** Whether a decision is confident enough to surface as a chip. */
export function worthSuggesting(d: RouteDecision): boolean {
  return d.lane !== 'frontier' && d.confidence >= ROUTER_CONFIDENCE_THRESHOLD;
}
