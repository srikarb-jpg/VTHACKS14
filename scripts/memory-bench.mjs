import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const mode = process.argv[2];
const cache = '.cache/memory-bench';
await mkdir(cache, { recursive: true });
if (!mode) {
  const reports = [];
  for (const name of ['minilm', 'gliner', 'combined']) {
    console.log(`Measuring ${name} in a fresh Node process...`);
    execFileSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), name], { stdio: 'inherit' });
    reports.push(JSON.parse(await readFile(`${cache}/${name}.json`, 'utf8')));
  }
  await writeFile(`${cache}/report.json`, JSON.stringify(reports, null, 2));
  console.log(`Saved ${cache}/report.json. RSS includes runtime/native allocations; these are NOT browser measurements.`);
  process.exit(0);
}
if (!['minilm', 'gliner', 'combined'].includes(mode)) throw new Error('Unknown mode');
const records = [];
function sample(stage) {
  const m = process.memoryUsage();
  const row = { stage, rssMiB: m.rss / 1048576, heapMiB: m.heapUsed / 1048576,
    externalMiB: m.external / 1048576, processPeakMiB: process.resourceUsage().maxRSS / 1024 };
  records.push(row);
  return row;
}
sample('baseline');
// Windows resolves native DLLs by load order. Load the root ORT 1.19 first:
// Transformers.js also brings ORT 1.14, whose DLL otherwise prevents GLiNER
// from loading. Apply the same order in all modes for consistent comparisons.
await import('onnxruntime-node');
let mini, ner;
async function phase(name, fn) {
  const start = performance.now();
  await fn();
  sample(name).elapsedMs = performance.now() - start;
}
if (mode !== 'gliner') {
  // Use the Transformers.js version already brought in by this checkout's GLiNER.
  await phase('MiniLM loaded', async () => {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = `${cache}/transformers`;
    mini = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  });
}
if (mode !== 'minilm') {
  await phase('GLiNER loaded', async () => {
    const { Gliner } = await import('gliner/node');
    const { env } = await import('@xenova/transformers');
    env.cacheDir = `${cache}/transformers`;
    let modelPath = '.cache/gliner/model_int8.onnx';
    const snapshots = join(homedir(), '.cache/huggingface/hub/models--onnx-community--gliner_small-v2.1/snapshots');
    if (!existsSync(modelPath) && existsSync(snapshots)) {
      for (const revision of await readdir(snapshots)) {
        const candidate = join(snapshots, revision, 'onnx/model_int8.onnx');
        if (existsSync(candidate)) { modelPath = candidate; break; }
      }
    }
    if (!existsSync(modelPath)) throw new Error('GLiNER int8 weights not cached. Run npm run bench:ner first.');
    ner = new Gliner({ tokenizerPath: 'onnx-community/gliner_small-v2.1',
      onnxSettings: { modelPath: new Uint8Array(await readFile(modelPath)) },
      transformersSettings: { allowLocalModels: false, useBrowserCache: false }, maxWidth: 12, modelType: 'span-level' });
    await ner.initialize();
  });
}
global.gc?.();
sample('loaded, after GC');
const short = 'Sarah Thompson works at Microsoft in Seattle. Please summarize these meeting notes.';
const long = `${'The team reviewed the project schedule and agreed on the next steps. '.repeat(20)}${short}`;
async function infer(text) {
  if (ner) await ner.inference({ texts: [text], entities: ['person', 'organization', 'location', 'job title', 'medical condition', 'employee id', 'project codename'], flatNer: true, threshold: 0.5 });
  if (mini) await mini(text, { pooling: 'mean', normalize: true });
}
await phase('first short inference', () => infer(short));
await phase('five warm short inferences', async () => { for (let i = 0; i < 5; i++) await infer(short); });
await phase('long inference (may truncate)', () => infer(long));
global.gc?.();
sample('after inference and GC');
const report = { mode, node: process.version, platform: process.platform,
  runtime: 'gliner 0.0.19 / Transformers.js 2.17.2 / native ONNX; MiniLM q8 + GLiNER int8',
  note: 'Peak is cumulative OS process high-water RSS, not isolated inference peak. GC does not necessarily release native memory. Download/loading buffers can inflate peak. Combined inference is sequential with both models resident.',
  records };
await writeFile(`${cache}/${mode}.json`, JSON.stringify(report, null, 2));
console.table(records.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? v.toFixed(1) : v]))));
await mini?.dispose();
