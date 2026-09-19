/**
 * The incremental scanner.
 *
 * This is the piece that makes an expensive detector affordable. Detectors
 * run per chunk and their results are cached by chunk hash, so typing one
 * character re-runs detection on one sentence rather than the whole prompt.
 * At submit we re-scan only what is dirty and read the rest from cache.
 *
 * The cache key includes the CONTEXT PADDING, not just the chunk. That costs
 * some hit rate -- editing a sentence also dirties its two neighbours -- but
 * it is the correct trade: without it, a detection that straddles a boundary
 * would be computed from stale surroundings.
 */
import type { Finding } from '../shared/types';
import { SEVERITY_ORDER } from '../shared/types';
import { resolveOverlaps } from './detectors';
import { CONTEXT, hash, splitStable } from './chunks';

export interface ScanStats {
  chunks: number;
  hits: number;
  misses: number;
  elapsedMs: number;
  /** True when the document was too large to cache and was scanned flat. */
  bypassed?: boolean;
}

export interface IncrementalResult {
  findings: Finding[];
  stats: ScanStats;
}

/** A finding plus whether the text around it has stopped moving. */
export type LiveFinding = Finding & { settled: boolean };

type DetectFn = (text: string) => Finding[];

/** Bound so a long session cannot grow the cache without limit. */
const MAX_ENTRIES = 512;

export class IncrementalScanner {
  private cache = new Map<string, Finding[]>();
  private lastStats: ScanStats = { chunks: 0, hits: 0, misses: 0, elapsedMs: 0 };

  constructor(private readonly detect: DetectFn) {}

  get stats(): ScanStats {
    return this.lastStats;
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  scan(text: string): IncrementalResult {
    const started = performance.now();
    const chunks = splitStable(text);

    // Bypass the cache when the document has more chunks than the cache can
    // hold. Otherwise every entry is evicted before it is ever reused, and
    // we pay the hashing cost for a hit rate of zero -- measured at 500 KB,
    // the cached path was SLOWER than a flat scan. Above this size a flat
    // scan is both simpler and faster.
    if (chunks.length > MAX_ENTRIES) {
      const findings = resolveOverlaps(this.detect(text));
      this.lastStats = {
        chunks: chunks.length,
        hits: 0,
        misses: chunks.length,
        elapsedMs: performance.now() - started,
        bypassed: true,
      };
      return { findings, stats: this.lastStats };
    }

    let hits = 0;
    let misses = 0;
    const collected: Finding[] = [];

    for (const chunk of chunks) {
      // Pad with surrounding text so a match crossing the boundary is seen.
      const padStart = Math.max(0, chunk.start - CONTEXT);
      const padEnd = Math.min(text.length, chunk.start + chunk.text.length + CONTEXT);
      const padded = text.slice(padStart, padEnd);
      const key = hash(padded);

      let found = this.cache.get(key);
      if (found) {
        hits++;
        // Refresh recency for the LRU bound.
        this.cache.delete(key);
        this.cache.set(key, found);
      } else {
        misses++;
        found = this.detect(padded);
        this.cache.set(key, found);
        if (this.cache.size > MAX_ENTRIES) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
      }

      // Rebase into document coordinates, then keep only findings that
      // actually start inside this chunk. A match living entirely in the
      // padding belongs to a neighbour and would otherwise be counted twice.
      const chunkEnd = chunk.start + chunk.text.length;
      for (const f of found) {
        const start = padStart + f.start;
        if (start < chunk.start || start >= chunkEnd) continue;
        collected.push({ ...f, start, end: padStart + f.end });
      }
    }

    // Two chunks can still surface the same span via overlapping padding.
    const deduped = dedupe(collected);
    const findings = resolveOverlaps(deduped);

    this.lastStats = {
      chunks: chunks.length,
      hits,
      misses,
      elapsedMs: performance.now() - started,
    };
    return { findings, stats: this.lastStats };
  }
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.start}:${f.end}:${f.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Characters that terminate a match, proving the user moved past it. */
const TERMINATORS = /[\s,;:)\]}"'<>]/;

/**
 * Is this finding stable enough to show?
 *
 * Mid-typing text is partial, and a partial match is usually a wrong match:
 * `dana@exam` is not an email yet, and `.com` may still become `.community`.
 * Rather than guess when the user is done, we apply a rule -- a finding is
 * settled once it is followed by a boundary character and the caret is not
 * inside it.
 *
 * At submit everything is settled by definition, so this only ever governs
 * what we DISPLAY, never what we redact.
 */
export function isSettled(f: Finding, text: string, caret: number | null): boolean {
  if (f.end >= text.length) return false;
  if (caret !== null && caret >= f.start && caret <= f.end) return false;
  return TERMINATORS.test(text[f.end] ?? ' ');
}

export function markSettled(
  findings: Finding[],
  text: string,
  caret: number | null,
): LiveFinding[] {
  return findings.map((f) => ({ ...f, settled: isSettled(f, text, caret) }));
}

/** Highest severity among findings, or null. */
export function maxSeverity(findings: Finding[]): Finding['severity'] | null {
  let max: Finding['severity'] | null = null;
  for (const f of findings) {
    if (max === null || SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(max)) {
      max = f.severity;
    }
  }
  return max;
}
