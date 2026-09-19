/**
 * Local GLiNER bench — runs OUTSIDE the browser.
 *
 * Isolates three questions that are tangled together when it fails in the
 * extension:
 *   1. Does the downloaded model actually load and run at all?
 *   2. How long does one inference really take on this machine?
 *   3. Are start/end character offsets or token indices?
 *
 * Uses the same `gliner` package and the same onnxruntime-web WASM backend
 * the extension uses, so a pass here points at the browser environment
 * (CSP, offscreen lifetime, messaging) rather than the model.
 *
 *   node scripts/ner-bench.mjs
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const REPO = 'onnx-community/gliner_small-v2.1';
const FILE = process.env.NER_FILE ?? 'onnx/model_int8.onnx';
const CACHE = '.cache/gliner';
const local = `${CACHE}/${FILE.split('/').pop()}`;

const SAMPLE =
  process.env.NER_TEXT ?? 'Amanda Britfield was my manager at Microsoft.';
const ENTITIES = ['person', 'organization', 'location', 'job title'];

async function ensureModel() {
  await mkdir(CACHE, { recursive: true });
  if (existsSync(local)) {
    const { size } = await stat(local);
    console.log(`model cached: ${local} (${(size / 1048576).toFixed(1)} MB)`);
    return;
  }
  const url = `https://huggingface.co/${REPO}/resolve/main/${FILE}`;
  console.log(`downloading ${url}`);
  const t0 = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(local, buf);
  console.log(`downloaded ${(buf.length / 1048576).toFixed(1)} MB in ${Date.now() - t0}ms`);
}

async function main() {
  console.log(`node ${process.version}`);
  await ensureModel();

  // The browser entry imports onnxruntime-web/webgpu, which the package
  // marks "node": null -- browser only. So in Node we go through gliner/node
  // (onnxruntime-node). Different runtime, same model and same pre/post
  // processing, which is what we are here to verify.
  const { Gliner } = await import('gliner/node');
  const { readFile } = await import('node:fs/promises');
  const bytes = new Uint8Array(await readFile(local));

  console.log('initializing (tokenizer fetches from HF on first run)…');
  const t0 = Date.now();
  const gliner = new Gliner({
    tokenizerPath: REPO,
    onnxSettings: { modelPath: bytes },
    transformersSettings: { allowLocalModels: false, useBrowserCache: false },
    maxWidth: 12,
    modelType: 'span-level',
  });
  await gliner.initialize();
  console.log(`initialized in ${Date.now() - t0}ms`);

  for (let i = 1; i <= 3; i++) {
    const t = Date.now();
    const out = await gliner.inference({
      texts: [SAMPLE],
      entities: ENTITIES,
      flatNer: true,
      threshold: 0.4,
    });
    const ms = Date.now() - t;
    const spans = out[0] ?? [];
    console.log(`\nrun ${i}: ${ms}ms — ${spans.length} span(s)`);
    for (const s of spans) {
      const slice = SAMPLE.slice(s.start, s.end);
      const kind = slice === s.spanText ? 'CHAR OFFSETS ✓' : `MISMATCH (slice="${slice}")`;
      console.log(
        `  "${s.spanText}" ${s.label} ${(s.score * 100).toFixed(0)}% [${s.start},${s.end}] ${kind}`,
      );
    }
  }
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
