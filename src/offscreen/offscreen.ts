/**
 * Offscreen detection host: the only place in the extension where a model
 * can actually run.
 *
 * Three constraints put it here and nowhere else:
 *   - Content scripts inherit the HOST page's CSP. claude.ai does not allow
 *     'wasm-unsafe-eval', so ONNX Runtime cannot compile there.
 *   - MV3 service workers are terminated after ~30s idle. A 183 MB model
 *     would be unloaded and refetched constantly.
 *   - Offscreen documents run under the EXTENSION's CSP, which we set to
 *     allow 'wasm-unsafe-eval', and they persist while they have work.
 *
 * Loading is staged deliberately. `probe` answers "can this machine run it
 * at all" without downloading 183 MB, so a failure is cheap and legible.
 */
import type { NerSpan, OffscreenRequest, OffscreenResponse, Probe } from '../shared/ner';

const MODEL_REPO = 'onnx-community/gliner_small-v2.1';

/**
 * int8 is a CPU quantization format. ONNX Runtime 1.19's WebGPU backend has
 * thin coverage of int8 operators and can STALL rather than fail on them --
 * inference simply never resolves. So the two are paired deliberately:
 *
 *   wasm   + model_int8  (175 MB)  known-good, what we ship
 *   webgpu + model_q4f16 (234 MB)  faster, but unverified here
 *
 * Selecting WebGPU merely because an adapter exists is what hung it.
 */
const VARIANTS = {
  wasm: { file: 'onnx/model_int8.onnx', provider: 'wasm' as const },
  webgpu: { file: 'onnx/model_q4f16.onnx', provider: 'webgpu' as const },
};

/** Flip to true only to experiment; wasm is the supported path. */
const PREFER_WEBGPU = false;

/** Hard ceiling on one inference. Without it a stall is indistinguishable
 *  from slowness and the UI sits on "running" forever. */
const INFERENCE_TIMEOUT_MS = 45_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/** Entity types GLiNER is asked for. Zero-shot, so this list is just config. */
export const DEFAULT_ENTITIES = [
  'person',
  'organization',
  'location',
  'job title',
  'medical condition',
  'employee id',
  'project codename',
];

type GlinerModule = typeof import('gliner');
type GlinerInstance = InstanceType<GlinerModule['Gliner']>;

let model: GlinerInstance | null = null;
let activeProvider = 'none';

/** Identifies this module instance. Changes only if the document restarts. */
const BOOT_ID = Math.random().toString(36).slice(2, 8);
let loading: Promise<void> | null = null;
let lastError: string | null = null;

/**
 * Capability probe. Cheap, and deliberately runs before any download so a
 * machine that cannot host the model says so in milliseconds rather than
 * after fetching 183 MB.
 */
async function probe(): Promise<Probe> {
  const result: Probe = {
    wasm: false,
    webgpu: false,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    error: null,
  };

  // Compiling a four-byte-header module is the smallest possible test that
  // 'wasm-unsafe-eval' is actually in effect.
  try {
    const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    await WebAssembly.instantiate(bytes);
    result.wasm = true;
  } catch (err) {
    result.error = `wasm blocked: ${String(err)}`;
  }

  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    result.webgpu = gpu ? (await gpu.requestAdapter()) !== null : false;
  } catch {
    result.webgpu = false;
  }

  return result;
}

/**
 * A URL for the model that does not depend on the network.
 *
 * onnxruntime-web downloads the model itself when handed an https URL, and
 * that leans on Chrome's HTTP cache -- which is not a place to keep a 175 MB
 * file. Hugging Face serves it through a redirect to a signed CDN URL, and
 * entries that large are commonly not retained. The symptom was a full
 * download after every offscreen teardown. So we keep the bytes in Cache
 * Storage ourselves, which persists across extension reloads (same origin),
 * and hand ORT a blob: URL backed by that stored copy.
 */
const MODEL_CACHE = 'pf-model-v1';
const MIN_MODEL_BYTES = 50_000_000;

async function localModelUrl(remote: string): Promise<{ url: string; revoke: () => void; source: string }> {
  const none = { revoke: () => undefined };
  try {
    const cache = await caches.open(MODEL_CACHE);
    let res = await cache.match(remote);
    let source = 'cache';
    if (!res) {
      source = 'network';
      const net = await fetch(remote);
      if (!net.ok) throw new Error(`model download failed: HTTP ${net.status}`);
      // put() only resolves once the whole body is stored, so an interrupted
      // download leaves nothing behind rather than a truncated model.
      await cache.put(remote, net);
      res = await cache.match(remote);
    }
    if (!res) throw new Error('model cache write did not persist');
    const blob = await res.blob();
    if (blob.size < MIN_MODEL_BYTES) {
      await cache.delete(remote);
      throw new Error(`cached model is ${blob.size} bytes; discarded`);
    }
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url), source };
  } catch (err) {
    // Storage unavailable or full: fall back to letting ORT download it, so
    // the feature still works, only slowly.
    console.warn('[prompt-firewall:offscreen] model cache unavailable, using network', err);
    return { url: remote, source: 'network (uncached)', ...none };
  }
}

async function ensureModel(): Promise<void> {
  if (model) return;
  if (loading) return loading;

  loading = (async () => {
    const caps = await probe();
    if (!caps.wasm) throw new Error(caps.error ?? 'WebAssembly unavailable');

    // Phase timing: the remedies for "bundle parse" and "ONNX session
    // creation" are completely different, so measure them apart.
    const tImport = performance.now();
    const { Gliner } = await import('gliner');
    const importMs = performance.now() - tImport;

    const variant = PREFER_WEBGPU && caps.webgpu ? VARIANTS.webgpu : VARIANTS.wasm;
    console.info(`[prompt-firewall:offscreen] loading ${variant.file} on ${variant.provider}`);

    const tFetch = performance.now();
    const local = await localModelUrl(
      `https://huggingface.co/${MODEL_REPO}/resolve/main/${variant.file}`,
    );
    console.info(
      `[prompt-firewall:offscreen] model bytes from ${local.source} in ` +
        `${(performance.now() - tFetch).toFixed(0)}ms`,
    );

    const instance = new Gliner({
      tokenizerPath: MODEL_REPO,
      onnxSettings: {
        modelPath: local.url,
        executionProvider: variant.provider,
        // ORT's .wasm binaries ship inside the extension rather than being
        // fetched from a CDN, so no remote code is ever loaded.
        wasmPaths: chrome.runtime.getURL('ort/'),
        // Threads need SharedArrayBuffer, which needs COOP/COEP headers we
        // cannot set on an offscreen document. Single-threaded it is.
        multiThread: false,
        fetchBinary: true,
      },
      transformersSettings: { allowLocalModels: false, useBrowserCache: true },
      maxWidth: 12,
      modelType: 'span-level',
    });

    const tInit = performance.now();
    try {
      await instance.initialize();
    } finally {
      local.revoke();
    }
    const initMs = performance.now() - tInit;
    model = instance;
    activeProvider = variant.provider;
    console.info(
      `[prompt-firewall:offscreen] load: import ${importMs.toFixed(0)}ms + ` +
        `initialize ${initMs.toFixed(0)}ms (tokenizer + ONNX session creation)`,
    );
    lastError = null;
  })();

  try {
    await loading;
  } catch (err) {
    lastError = String(err);
    throw err;
  } finally {
    loading = null;
  }
}

/**
 * Batched inference. GLiNER accepts several texts in one call, and one call
 * over N chunks is markedly cheaper than N calls -- the per-call overhead
 * (tokenizing the label set, session setup) is paid once instead of N times.
 */
async function detect(
  texts: string[],
  entities: string[],
  threshold: number,
): Promise<{ spans: NerSpan[][]; inferMs: number; loadMs: number }> {
  const loadStart = performance.now();
  await ensureModel();
  const loadMs = performance.now() - loadStart;
  if (loadMs > 100) {
    console.warn(
      `[prompt-firewall:offscreen] model (re)loaded in ${loadMs.toFixed(0)}ms — ` +
        `the document was torn down since the last call`,
    );
  }
  if (!model || texts.length === 0) {
    return { spans: texts.map(() => []), inferMs: 0, loadMs };
  }

  const started = performance.now();
  const out = await withTimeout(
    model.inference({ texts, entities, flatNer: true, threshold }),
    INFERENCE_TIMEOUT_MS,
    'inference',
  );
  const chars = texts.reduce((n, s) => n + s.length, 0);
  console.info(
    `[prompt-firewall:offscreen] inference ${(performance.now() - started).toFixed(0)}ms ` +
      `for ${texts.length} chunk(s) / ${chars} chars`,
  );

  return {
    loadMs,
    inferMs: performance.now() - started,
    spans: texts.map((_, i) =>
      (out[i] ?? []).map((e) => ({
        start: e.start,
        end: e.end,
        label: e.label,
        score: e.score,
        text: e.spanText,
      })),
    ),
  };
}

chrome.runtime.onMessage.addListener(
  (msg: OffscreenRequest & { target?: string }, _sender, sendResponse) => {
    if (msg.target !== 'offscreen') return undefined;

    const reply = (r: OffscreenResponse): void => sendResponse(r);

    void (async () => {
      try {
        switch (msg.type) {
          case 'ner:ping':
            reply({ type: 'ner:pong', bootId: BOOT_ID, loaded: model !== null });
            return;
          case 'ner:probe':
            reply({ type: 'ner:probe-result', probe: await probe(), loaded: model !== null, error: lastError });
            return;
          case 'ner:load':
            await ensureModel();
            reply({ type: 'ner:loaded', ok: true, error: null });
            return;
          case 'ner:selftest': {
            const sample = 'Amanda Britfield was my manager at Microsoft.';
            const t0 = performance.now();
            const r = await detect([sample], DEFAULT_ENTITIES, 0.4);
            const spans = r.spans[0] ?? [];
            reply({
              type: 'ner:selftest-result',
              ms: performance.now() - t0,
              spans,
              provider: activeProvider,
              error: null,
            });
            return;
          }
          case 'ner:detect': {
            const r = await detect(msg.texts, msg.entities ?? DEFAULT_ENTITIES, msg.threshold ?? 0.5);
            reply({
              type: 'ner:spans',
              spans: r.spans,
              inferMs: r.inferMs,
              loadMs: r.loadMs,
              bootId: BOOT_ID,
              error: null,
            });
            return;
          }
          default:
            reply({ type: 'ner:error', error: 'unknown request' });
        }
      } catch (err) {
        console.error('[prompt-firewall:offscreen]', err);
        reply({ type: 'ner:error', error: String(err) });
      }
    })();

    return true; // async response
  },
);

void (async () => {
  const caps = await probe();
  console.info(`[prompt-firewall:offscreen] ready boot=${BOOT_ID}`, caps);
})();
