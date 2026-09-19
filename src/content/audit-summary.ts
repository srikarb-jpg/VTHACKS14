import type { Finding } from '../shared/types';

/** Model findings carry their score in the label ("person (65%)"); grouping needs it gone. */
const baseLabel = (label: string): string => label.replace(/\s*\(\d+%\)\s*$/, '');

/** "3 person · 1 email address" -- counts by label, most common first. */
export function summarizeFindings(findings: Finding[]): string {
  if (!findings.length) return 'Nothing sensitive found in the reply.';
  const counts = new Map<string, number>();
  for (const f of findings) {
    const label = baseLabel(f.label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, n]) => `${n} ${label.toLowerCase()}`)
    .join(' · ');
}

/** Words that name the assistant or its maker. Claude's reply is full of them and they are not the user's data. */
const OWN_NAMES = new Set(['claude', 'anthropic']);

export function dropOwnNames(findings: Finding[]): Finding[] {
  return findings.filter((f) => !OWN_NAMES.has(f.value.trim().toLowerCase()));
}
