import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { rows } from './binary-router-data.mjs';

const command = process.argv[2] ?? 'test';
const artifact = new URL('../dev/binary-router-model.json', import.meta.url);
const memory = [];
function snapshot(stage) {
  memory.push({ stage, rssMiB: process.memoryUsage().rss / 1048576, peakMiB: process.resourceUsage().maxRSS / 1024 });
}
snapshot('baseline');
// Load newer native ORT first to avoid the Windows DLL conflict in this checkout.
await import('onnxruntime-node');
const { pipeline, env } = await import('@xenova/transformers');
env.cacheDir = '.cache/memory-bench/transformers';
const modelId = 'Xenova/all-MiniLM-L6-v2';
const extractor = await pipeline('feature-extraction', modelId, { quantized: true });
snapshot('MiniLM loaded');
const timings = [];
async function embed(text) {
  const start = performance.now();
  const tensor = await extractor(text, { pooling: 'mean', normalize: true });
  timings.push(performance.now() - start);
  const vector = Array.from(tensor.data);
  assert.equal(vector.length, 384);
  assert(vector.every(Number.isFinite));
  return vector;
}
const sigmoid = x => 1 / (1 + Math.exp(-x));
const score = (model, vector) => sigmoid(vector.reduce((s, x, i) => s + x * model.weights[i], model.bias));
function evaluate(model, examples) {
  const predictions = examples.map(row => {
    const searchScore = score(model, row.vector);
    return { text: row.text, expected: row.label, predicted: searchScore >= model.threshold ? 'searchable' : 'frontier', searchScore };
  });
  const frontier = predictions.filter(r => r.expected === 'frontier');
  const falseSearch = frontier.filter(r => r.predicted === 'searchable').length;
  return { accuracy: predictions.filter(r => r.predicted === r.expected).length / predictions.length,
    falseSearch, frontierCount: frontier.length,
    perLabel: Object.fromEntries(['searchable', 'frontier'].map(label => {
      const subset = predictions.filter(r => r.expected === label);
      return [label, { total: subset.length, correct: subset.filter(r => r.predicted === label).length }];
    })), predictions };
}
try {
  if (command === 'train') {
    assert.equal(new Set(rows.map(r => r.text.toLowerCase())).size, rows.length);
    const encoded = [];
    for (const row of rows) encoded.push({ ...row, vector: await embed(row.text) });
    const training = encoded.filter(r => r.split === 'train');
    const model = { modelId, quantized: true, pooling: 'mean', normalize: true, labels: ['frontier', 'searchable'], weights: Array(384).fill(0), bias: 0, threshold: 0.7 };
    for (let epoch = 0; epoch < 1500; epoch++) {
      const gradient = Array(384).fill(0);
      let db = 0;
      for (const row of training) {
        const error = score(model, row.vector) - Number(row.label === 'searchable');
        db += error / training.length;
        row.vector.forEach((v, i) => { gradient[i] += error * v / training.length; });
      }
      model.weights = model.weights.map((v, i) => v - gradient[i] - 0.001 * v);
      model.bias -= db;
    }
    const validation = encoded.filter(r => r.split === 'validation');
    const options = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1].map(threshold => ({ threshold, ...evaluate({ ...model, threshold }, validation) }));
    model.threshold = options.filter(r => r.falseSearch === 0).sort((a, b) => b.accuracy - a.accuracy || b.threshold - a.threshold)[0].threshold;
    await writeFile(artifact, JSON.stringify(model));
    const report = { synthetic: true, trainCount: training.length, validation: evaluate(model, validation), test: evaluate(model, encoded.filter(r => r.split === 'test')) };
    await writeFile(new URL('../dev/binary-router-evaluation.json', import.meta.url), JSON.stringify(report, null, 2));
    console.log(`Trained ${training.length} examples; threshold ${model.threshold}; validation ${validation.length}; held-out ${report.test.predictions.length}.`);
    console.table(report.test.predictions);
    console.log(`Accuracy ${report.test.accuracy}; false-search ${report.test.falseSearch}/${report.test.frontierCount}`);
  } else if (command === 'test') {
    const model = JSON.parse(await readFile(artifact, 'utf8'));
    const prompts = process.argv.slice(3).length ? [{ text: process.argv.slice(3).join(' '), label: 'user input' }] : rows.filter(r => r.split === 'test');
    const encoded = [];
    for (const row of prompts) {
      if (!row.text.trim()) throw new Error('Prompt cannot be empty');
      encoded.push({ ...row, vector: await embed(row.text) });
    }
    const report = evaluate(model, encoded);
    snapshot('after predictions');
    global.gc?.();
    snapshot('after GC');
    console.table(report.predictions);
    console.table(memory);
    const warm = timings.slice(1).sort((a, b) => a - b);
    const result = { ...report, memory, threshold: model.threshold, firstInferenceMs: timings[0], warmMedianMs: warm[Math.floor(warm.length / 2)] ?? null,
      note: 'Node native runtime; total process RSS, not browser RAM. Synthetic held-out set. Scores are uncalibrated. GLiNER not loaded.' };
    await mkdir('.cache/binary-router', { recursive: true });
    await writeFile('.cache/binary-router/results.json', JSON.stringify(result, null, 2));
    console.log(`Threshold ${model.threshold}; first inference ${timings[0].toFixed(1)} ms; warm median ${result.warmMedianMs?.toFixed(1) ?? 'n/a'} ms.`);
    console.log('Saved .cache/binary-router/results.json. No GLiNER, privacy scanning, or browser routing is run here.');
  } else throw new Error('Use train or test');
} finally { await extractor.dispose(); }
