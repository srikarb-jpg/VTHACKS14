/**
 * Detector registry and overlap resolution.
 *
 * Detectors are deliberately allowed to overlap -- an email inside a
 * credential assignment will match twice. Resolving by severity and then by
 * span length means the more serious and more specific finding wins, so
 * `api_key = "user@host.com"` redacts as a credential, not as an email.
 */
import type { Finding, ScanResult, Severity } from '../../shared/types';
import { SEVERITY_ORDER } from '../../shared/types';
import { detectMarkings } from './markings';
import { detectSecrets } from './secrets';
import { detectIdentifiers } from './identifiers';
import { detectContact } from './contact';

export const DETECTORS = [detectMarkings, detectSecrets, detectIdentifiers, detectContact];

function overlaps(a: Finding, b: Finding): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Highest severity first, then longest span, then earliest position. */
function rank(a: Finding, b: Finding): number {
  const s = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
  if (s !== 0) return s;
  const len = b.end - b.start - (a.end - a.start);
  if (len !== 0) return len;
  return a.start - b.start;
}

export function resolveOverlaps(findings: Finding[]): Finding[] {
  const kept: Finding[] = [];
  for (const f of [...findings].sort(rank)) {
    if (!kept.some((k) => overlaps(k, f))) kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function scan(text: string): ScanResult {
  const started = performance.now();
  const raw = DETECTORS.flatMap((d) => d(text));
  const findings = resolveOverlaps(raw);
  let maxSeverity: Severity | null = null;
  for (const f of findings) {
    if (maxSeverity === null || SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(maxSeverity)) {
      maxSeverity = f.severity;
    }
  }
  return { findings, maxSeverity, elapsedMs: performance.now() - started };
}
