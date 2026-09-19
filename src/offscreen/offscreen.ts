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

async function ensureModel(): Promise<void> {
  if (model) return;
  if (loading) return loading;

  loading = (async () => {
    const caps = await probe();
    if (!caps.wasm) throw new Error(caps.error ?? 'WebAssembly unavailable');

    const { Gliner } = await import('gliner');

    const variant = PREFER_WEBGPU && caps.webgpu ? VARIANTS.webgpu : VARIANTS.wasm;
    console.info(`[prompt-firewall:offscreen] loading ${variant.file} on ${variant.provider}`);

    const instance = new Gliner({
      tokenizerPath: MODEL_REPO,
      onnxSettings: {
        modelPath: `https://huggingface.co/${MODEL_REPO}/resolve/main/${variant.file}`,
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

    await instance.initialize();
    model = instance;
    activeProvider = variant.provider;
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

async function detect(text: string, entities: string[], threshold: number): Promise<NerSpan[]> {
  await ensureModel();
  if (!model) return [];

  const started = performance.now();
  const out = await withTimeout(
    model.inference({ texts: [text], entities, flatNer: true, threshold }),
    INFERENCE_TIMEOUT_MS,
    'inference',
  );
  console.info(
    `[prompt-firewall:offscreen] inference ${(performance.now() - started).toFixed(0)}ms ` +
      `for ${text.length} chars -> ${(out[0] ?? []).length} spans`,
  );

  return (out[0] ?? []).map((e) => ({
    start: e.start,
    end: e.end,
    label: e.label,
    score: e.score,
    text: e.spanText,
  }));
}

chrome.runtime.onMessage.addListener(
  (msg: OffscreenRequest & { target?: string }, _sender, sendResponse) => {
    if (msg.target !== 'offscreen') return undefined;

    const reply = (r: OffscreenResponse): void => sendResponse(r);

    void (async () => {
      try {
        switch (msg.type) {
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
            const spans = await detect(sample, DEFAULT_ENTITIES, 0.4);
            reply({
              type: 'ner:selftest-result',
              ms: performance.now() - t0,
              spans,
              provider: activeProvider,
              error: null,
            });
            return;
          }
          case 'ner:detect':
            reply({
              type: 'ner:spans',
              spans: await detect(msg.text, msg.entities ?? DEFAULT_ENTITIES, msg.threshold ?? 0.5),
              error: null,
            });
            return;
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
  console.info('[prompt-firewall:offscreen] ready', caps);
})();
