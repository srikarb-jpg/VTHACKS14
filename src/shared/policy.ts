/**
 * Typed policy: an organization's own sensitive formats, written as data.
 *
 * The idea is a division of labour. A language model is good at turning
 * "our contract numbers look like W15P7T-19-D-0042" into a pattern, and
 * terrible at being run on every keystroke of sensitive text. So the model
 * (any assistant, at authoring time) writes the pattern, and this extension
 * enforces it locally, deterministically, on the user's own device. The
 * assistant only ever sees a description of a FORMAT, never real data.
 *
 * Measured on the bench, the small on-device NER model found 3-4 of 12
 * structured identifiers when handed their names as labels. Patterns found
 * them all. That is why policy rules are patterns and not labels.
 *
 * A policy arrives from outside (pasted from an assistant), and a pattern can
 * freeze a page: nested repeats like `(a+)+$` take exponential time on the
 * text a user is typing. JavaScript cannot interrupt a running regex, so the
 * only defence is refusing dangerous patterns before they ever run.
 */
import type { Severity } from './types';

export type PolicySeverity = 'low' | 'medium' | 'high';

export interface PolicyRule {
  /** Shown to the user and used to name the placeholder: "contract number" -> [CONTRACT_NUMBER_1]. */
  name: string;
  /** JavaScript regular expression source, no delimiters or flags. */
  pattern: string;
  ignoreCase?: boolean;
  /** medium (default) redacts automatically; low only highlights until the user confirms. Never block. */
  severity?: PolicySeverity;
}

export interface Policy {
  schemaVersion: 1;
  name?: string;
  rules: PolicyRule[];
}

export const LIMITS = {
  rules: 25,
  name: 60,
  pattern: 200,
  /** Largest bounded repeat, e.g. {1,100}. */
  repeat: 100,
  /** `*`, `+` and `{n,}` per pattern. Two keeps worst-case backtracking quadratic. */
  unbounded: 2,
} as const;

/**
 * Why a pattern is refused, or null if it is acceptable.
 *
 * Deliberately conservative: a legitimate format ("two letters, six digits")
 * never needs the constructs refused here, and a refused one costs the user a
 * rewrite while an accepted bad one costs a frozen tab.
 */
export function unsafePattern(src: string): string | null {
  if (src.length === 0 || src.length > LIMITS.pattern) {
    return `Pattern must be 1 to ${LIMITS.pattern} characters.`;
  }
  if (/\(\?<|\(\?[=!]/.test(src)) return 'Lookahead, lookbehind and named groups are not allowed.';
  if (/\\[1-9]|\\k</.test(src)) return 'Backreferences are not allowed.';
  try {
    new RegExp(src);
  } catch {
    return 'Not a valid regular expression.';
  }

  interface Group {
    quant: boolean;
    alt: boolean;
  }
  const stack: Group[] = [];
  let unbounded = 0;
  // The group that has just closed and may be about to be repeated.
  let closed: Group | null = null;

  const repeat = (kind: 'optional' | 'unbounded' | 'bounded', max = 0): string | null => {
    if (kind === 'unbounded' && ++unbounded > LIMITS.unbounded) {
      return `At most ${LIMITS.unbounded} open-ended repeats (*, +, {n,}) are allowed.`;
    }
    if (kind === 'bounded' && max > LIMITS.repeat) return `Repeat counts may not exceed ${LIMITS.repeat}.`;
    // Repeating a group that itself repeats or branches is the classic
    // exponential-backtracking shape: (a+)+, (a|a)*.
    if (closed && kind !== 'optional' && (closed.quant || closed.alt)) {
      return 'A repeated group may not itself contain repeats or alternatives.';
    }
    const top = stack[stack.length - 1];
    if (top) top.quant = true;
    closed = null;
    return null;
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    let problem: string | null = null;

    if (c === '\\') {
      closed = null;
      i += 2;
    } else if (c === '[') {
      closed = null;
      i++;
      while (i < n && src[i] !== ']') i += src[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === '(') {
      closed = null;
      stack.push({ quant: false, alt: false });
      i++;
      if (src[i] === '?' && src[i + 1] === ':') i += 2;
    } else if (c === ')') {
      closed = stack.pop() ?? null;
      i++;
    } else if (c === '|') {
      closed = null;
      const top = stack[stack.length - 1];
      if (top) top.alt = true;
      i++;
    } else if (c === '*' || c === '+') {
      problem = repeat('unbounded');
      i++;
      if (src[i] === '?') i++;
    } else if (c === '?') {
      problem = repeat('optional');
      i++;
      if (src[i] === '?') i++;
    } else if (c === '{') {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i));
      if (m) {
        const open = m[2] !== undefined && m[3] === '';
        problem = open ? repeat('unbounded') : repeat('bounded', Number(m[2] ? m[3] : m[1]));
        i += m[0].length;
        if (src[i] === '?') i++;
      } else {
        closed = null;
        i++;
      }
    } else {
      closed = null;
      i++;
    }
    if (problem) return problem;
  }
  return null;
}

/** "contract number" -> "CONTRACT_NUMBER"; safe to embed in a placeholder. */
export function stemFor(name: string): string {
  const s = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
    .replace(/_+$/g, '');
  if (!s) return 'CUSTOM';
  return /^[A-Z]/.test(s) ? s : `X_${s}`;
}

/**
 * Assistants routinely write regex escapes with ONE backslash inside JSON
 * (like `\d`), and chat windows often collapse a correct pair (`\\d`) to one
 * when copied. Strict JSON rejects `\d`, and worse, ACCEPTS `\b` -- as a
 * backspace character, so a word-boundary pattern would be silently accepted
 * and never match anything.
 *
 * Inside strings, a lone backslash is therefore treated as a regex escape and
 * doubled; an already-doubled pair is left alone, so correct JSON round-trips.
 */
export function repairEscapes(json: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i] as string;
    if (!inString) {
      out += c;
      if (c === '"') inString = true;
      continue;
    }
    if (c === '"') {
      out += c;
      inString = false;
    } else if (c === '\\') {
      const next = json[i + 1];
      if (next === undefined) {
        out += '\\\\';
      } else if (next === '\\' || next === '"') {
        out += c + next; // an existing pair or escaped quote
        i++;
      } else {
        out += '\\\\' + next; // a lone regex escape: \d, \b, \s ...
        i++;
      }
    } else {
      out += c;
    }
  }
  return out;
}

export type ParseResult = { ok: true; policy: Policy } | { ok: false; errors: string[] };

/** Accepts the JSON an assistant returns, with or without a markdown fence around it. */
export function parsePolicy(input: string): ParseResult {
  const start = input.indexOf('{');
  const end = input.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, errors: ['No JSON object found.'] };

  let raw: unknown;
  try {
    raw = JSON.parse(repairEscapes(input.slice(start, end + 1)));
  } catch (err) {
    const why = err instanceof Error ? ` (${err.message.slice(0, 80)})` : '';
    return { ok: false, errors: [`That is not valid JSON${why}.`] };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['Expected a JSON object.'] };

  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (obj.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (!Array.isArray(obj.rules) || obj.rules.length === 0) {
    errors.push('rules must be a non-empty list.');
    return { ok: false, errors };
  }
  if (obj.rules.length > LIMITS.rules) errors.push(`At most ${LIMITS.rules} rules.`);

  const rules: PolicyRule[] = [];
  obj.rules.slice(0, LIMITS.rules).forEach((r: unknown, idx: number) => {
    const at = `Rule ${idx + 1}`;
    if (typeof r !== 'object' || r === null) {
      errors.push(`${at}: expected an object.`);
      return;
    }
    const rule = r as Record<string, unknown>;
    const name = typeof rule.name === 'string' ? rule.name.trim() : '';
    if (!name || name.length > LIMITS.name) errors.push(`${at}: name must be 1 to ${LIMITS.name} characters.`);
    if (typeof rule.pattern !== 'string') {
      errors.push(`${at}: pattern must be text.`);
      return;
    }
    const why = unsafePattern(rule.pattern);
    if (why) errors.push(`${at} (${name || 'unnamed'}): ${why}`);

    const severity = rule.severity ?? 'medium';
    if (severity !== 'low' && severity !== 'medium' && severity !== 'high') {
      errors.push(`${at}: severity must be low, medium or high. Policies cannot block a send.`);
      return;
    }
    if (rule.ignoreCase !== undefined && typeof rule.ignoreCase !== 'boolean') {
      errors.push(`${at}: ignoreCase must be true or false.`);
    }
    if (!name || why) return;
    rules.push({
      name,
      pattern: rule.pattern,
      ...(rule.ignoreCase === true ? { ignoreCase: true } : {}),
      severity,
    });
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    policy: {
      schemaVersion: 1,
      ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim().slice(0, LIMITS.name) } : {}),
      rules,
    },
  };
}

export interface CompiledRule {
  name: string;
  stem: string;
  re: RegExp;
  severity: Severity;
}

/**
 * Turn a stored policy into runnable rules. Re-checks every pattern: what is
 * in storage is not trusted just because it was validated when it was saved.
 */
export function compileRules(policy: Policy | null | undefined): CompiledRule[] {
  if (!policy || policy.schemaVersion !== 1 || !Array.isArray(policy.rules)) return [];
  const out: CompiledRule[] = [];
  for (const r of policy.rules.slice(0, LIMITS.rules)) {
    if (typeof r?.pattern !== 'string' || typeof r.name !== 'string' || unsafePattern(r.pattern)) continue;
    out.push({
      name: r.name,
      stem: stemFor(r.name),
      re: new RegExp(r.pattern, r.ignoreCase ? 'gi' : 'g'),
      severity: r.severity === 'low' || r.severity === 'high' ? r.severity : 'medium',
    });
  }
  return out;
}

/** Paste this into any assistant. It never needs to see real data. */
export const POLICY_ASSISTANT_INSTRUCTIONS = `You turn descriptions of sensitive data FORMATS into a JSON policy for a browser extension that redacts text locally.

The user describes what identifiers look like (for example "our contract numbers look like W15P7T-19-D-0042"). Write patterns from the SHAPE. If they give an example, treat it as a shape only, and ask them to use a made-up example, never a real value. If they paste something that looks like real personal or secret data, tell them to remove it and stop.

Output ONE JSON object and nothing else:
{
  "schemaVersion": 1,
  "name": "short policy name",
  "rules": [
    { "name": "contract number", "pattern": "\\\\b[A-Z0-9]{5,6}-\\\\d{2}-[A-Z]-\\\\d{4}\\\\b", "severity": "medium" }
  ]
}

Pattern rules (the extension rejects anything else):
- JavaScript regular expression source. Escape backslashes for JSON.
- Anchor with \\\\b so it does not match inside longer words.
- No lookahead, lookbehind, named groups or backreferences.
- Never repeat a group that contains a repeat or an alternative, like (a+)+ or (a|b)*.
- At most two open-ended repeats (*, + or {n,}). Bounded repeats up to 100.
- Under 200 characters. At most 25 rules.
- "severity": "medium" replaces automatically; use it for rigid formats. Use "low" when the format is ambiguous, so the user confirms each one. Never "block".
- Optional "ignoreCase": true.

Prefer precise formats to broad ones: a false match silently rewrites the user's prompt.`;
