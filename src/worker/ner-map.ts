/**
 * Mapping GLiNER output into Findings.
 *
 * Everything the model produces lands in the LOW tier, which means highlight
 * only and never auto-redaction -- regardless of how confident the model
 * claims to be. NER recall is incomplete and its errors are confident, so a
 * span from a transformer is a suggestion to a human, not an instruction to
 * rewrite the prompt. This is design principle 3, and it is also what makes
 * a stale or missing NER result harmless.
 */
import type { Finding, FindingKind } from '../shared/types';
import type { NerSpan } from '../shared/ner';

/**
 * GLiNER is zero-shot, so these strings are the prompt, not a trained label
 * set. Changing them changes what it looks for -- no retraining involved.
 */
export const ENTITY_LABELS = [
  'person',
  'organization',
  'location',
  'job title',
  'medical condition',
  'employee id',
  'project codename',
] as const;

const LABEL_TO_KIND: Record<string, FindingKind> = {
  person: 'person',
  organization: 'organization',
  location: 'location',
  'job title': 'organization',
  'medical condition': 'person',
  'employee id': 'person',
  'project codename': 'organization',
};

/**
 * Minimum score to surface at all. Deliberately not a severity gate -- a
 * low-scoring PERSON is still only ever a highlight. This just keeps the
 * panel readable.
 */
export const MIN_SCORE = 0.45;

export function nerSpansToFindings(spans: NerSpan[]): Finding[] {
  const out: Finding[] = [];
  for (const s of spans) {
    if (s.score < MIN_SCORE) continue;
    const kind = LABEL_TO_KIND[s.label.toLowerCase()];
    if (!kind) continue;
    if (s.end <= s.start) continue;
    out.push({
      kind,
      severity: 'low',
      label: `${s.label} (${Math.round(s.score * 100)}%)`,
      start: s.start,
      end: s.end,
      value: s.text,
      detector: `ner.${s.label.replace(/\s+/g, '_')}`,
    });
  }
  return out;
}
