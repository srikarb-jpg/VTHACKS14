/**
 * Classification and control markings. This is the only tier that blocks.
 *
 * Precision matters more here than anywhere else in the product: a false
 * positive does not merely annoy the user, it prevents them from sending.
 * So we match on formal marking SYNTAX -- banner lines and portion markings --
 * never on bare keywords. The word "controlled" in an ordinary sentence must
 * not stop a send, and "this is export controlled software" must not either.
 *
 * References: 32 CFR Part 2002 (CUI), DoDM 5200.01 marking conventions.
 */
import type { Finding } from '../../shared/types';

/** Portion markings: (U), (CUI), (U//FOUO), (S//NOFORN), (TS//SI//NOFORN). */
const PORTION_MARKING =
  /\((?:U|C|S|TS|CUI)(?:\/\/(?:FOUO|NOFORN|REL TO [A-Z, ]+|SI|TK|HCS|ORCON|PROPIN|FISA|SP-[A-Z]+|[A-Z]{2,8}))*\)/g;

/**
 * Banner lines. These appear alone on a line, usually upper-cased, at the top
 * or bottom of a document. Anchoring to line boundaries is what keeps this
 * from firing on prose.
 */
const BANNER_LINE =
  /^[ \t]*(?:CONTROLLED UNCLASSIFIED INFORMATION|CUI\/\/(?:SP-)?[A-Z-]+|UNCLASSIFIED\/\/FOR OFFICIAL USE ONLY|SECRET(?:\/\/[A-Z ,-]+)?|TOP SECRET(?:\/\/[A-Z ,-]+)?|CONFIDENTIAL\/\/[A-Z ,-]+)[ \t]*$/gm;

/**
 * Export-control statements. Matched as full declarative phrases, because the
 * individual words are far too common on their own.
 */
const EXPORT_CONTROL =
  /(?:ITAR[- ]controlled|subject to the International Traffic in Arms Regulations|Export Administration Regulations|EAR99|ECCN\s+\d[A-E]\d{3}|controlled under (?:the )?(?:ITAR|EAR))/gi;

interface Rule {
  pattern: RegExp;
  label: string;
  detector: string;
}

const RULES: Rule[] = [
  { pattern: PORTION_MARKING, label: 'Classification portion marking', detector: 'markings.portion' },
  { pattern: BANNER_LINE, label: 'Classification banner line', detector: 'markings.banner' },
  { pattern: EXPORT_CONTROL, label: 'Export control marking', detector: 'markings.export' },
];

/**
 * `(U)` alone is an unclassified portion marking and blocking on it would be
 * absurd, but it is also a common false positive shape. We keep it only when
 * it carries a dissemination control, i.e. it contains a `//`.
 */
function isBlockworthyPortionMarking(match: string): boolean {
  if (!match.startsWith('(U)')) return true;
  return match.includes('//');
}

export function detectMarkings(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const m of text.matchAll(rule.pattern)) {
      if (m.index === undefined) continue;
      const value = m[0].trim();
      if (!value) continue;
      if (rule.detector === 'markings.portion' && !isBlockworthyPortionMarking(value)) {
        continue;
      }
      findings.push({
        kind: 'classification_marking',
        severity: 'block',
        label: rule.label,
        start: m.index,
        end: m.index + m[0].length,
        value,
        detector: rule.detector,
      });
    }
  }
  return findings;
}
