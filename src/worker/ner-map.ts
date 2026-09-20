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
  school: 'organization',
  university: 'organization',
  city: 'location',
  state: 'location',
  'postal code': 'location',
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

/**
 * Map spans to findings, verifying the offsets against the source text.
 *
 * GLiNER reports start/end that may be TOKEN indices rather than character
 * offsets depending on the model type, and a wrong offset draws an underline
 * under the wrong words -- which looks like a detection bug rather than an
 * indexing one. So we check, and repair by locating spanText when the check
 * fails. A span we cannot place is dropped rather than drawn wrongly.
 */
export function nerSpansToFindings(spans: NerSpan[], text: string): Finding[] {
  const out: Finding[] = [];
  const used = new Set<number>();

  for (const s of spans) {
    if (s.score < MIN_SCORE) continue;
    const kind = LABEL_TO_KIND[s.label.toLowerCase()];
    if (!kind) continue;

    let { start, end } = s;
    const matchesAtOffsets =
      end > start && end <= text.length && text.slice(start, end) === s.text;

    if (!matchesAtOffsets) {
      // Offsets did not line up. Find the span's text instead, preferring an
      // occurrence we have not already claimed so repeated names still get
      // one finding each.
      let idx = text.indexOf(s.text);
      while (idx !== -1 && used.has(idx)) idx = text.indexOf(s.text, idx + 1);
      if (idx === -1 || !s.text) continue;
      start = idx;
      end = idx + s.text.length;
    }
    used.add(start);

    out.push({
      kind,
      severity: 'low',
      label: `${s.label} (${Math.round(s.score * 100)}%)`,
      start,
      end,
      value: s.text,
      detector: `ner.${s.label.replace(/\s+/g, '_')}`,
      score: s.score,
    });
  }
  return out;
}
