/**
 * Detector for user-supplied policy rules.
 *
 * The text is scanned in bounded windows rather than in one piece, so however
 * large a paste is, no single regex call sees more than WINDOW characters.
 * With the pattern validator capping open-ended repeats at two, that keeps
 * the worst case small and predictable.
 */
import type { Finding } from '../../shared/types';
import type { CompiledRule } from '../../shared/policy';

const WINDOW = 1500;
const STEP = 1400; // windows overlap, so a match on a boundary is still seen whole
const MAX_HITS_PER_RULE = 200;

export function detectCustom(text: string, rules: readonly CompiledRule[]): Finding[] {
  if (!rules.length) return [];
  const out: Finding[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    let hits = 0;
    for (let base = 0; base < text.length && hits < MAX_HITS_PER_RULE; base += STEP) {
      for (const m of text.slice(base, base + WINDOW).matchAll(rule.re)) {
        if (m.index === undefined || m[0].length === 0) continue;
        const start = base + m.index;
        const end = start + m[0].length;
        const key = `${rule.stem}:${start}:${end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          kind: 'custom',
          severity: rule.severity,
          label: rule.name,
          stem: rule.stem,
          start,
          end,
          value: m[0],
          detector: `custom.${rule.stem}`,
        });
        if (++hits >= MAX_HITS_PER_RULE) break;
      }
    }
  }
  return out;
}
