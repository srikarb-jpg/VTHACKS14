/**
 * Contracts for the offscreen NER host.
 *
 * Kept separate from messages.ts because this channel is background <->
 * offscreen, not content <-> background, and conflating them made the
 * exhaustiveness checks in the service worker useless.
 */

export interface Probe {
  /** Did a minimal WebAssembly module compile? Proves the CSP allows it. */
  wasm: boolean;
  webgpu: boolean;
  /** Threads need SharedArrayBuffer, which needs this. Expected false. */
  crossOriginIsolated: boolean;
  /** navigator.deviceMemory, in GB. Coarse and often absent. */
  deviceMemoryGb: number | null;
  error: string | null;
}

/** One entity as GLiNER reports it, before mapping into a Finding. */
export interface NerSpan {
  start: number;
  end: number;
  label: string;
  score: number;
  text: string;
}

export type OffscreenRequest =
  | { type: 'ner:probe' }
  | { type: 'ner:load' }
  | { type: 'ner:detect'; text: string; entities?: string[]; threshold?: number };

export type OffscreenResponse =
  | { type: 'ner:probe-result'; probe: Probe; loaded: boolean; error: string | null }
  | { type: 'ner:loaded'; ok: boolean; error: string | null }
  | { type: 'ner:spans'; spans: NerSpan[]; error: string | null }
  | { type: 'ner:error'; error: string };
