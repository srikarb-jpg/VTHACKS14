/**
 * Compare GLiNER label sets on a piece of text, outside the browser.
 * Labels are the prompt for a zero-shot model, so which words we pick decides
 * what it finds -- this is how to choose them with evidence.
 *
 *   NER_TEXT_FILE=sample.txt node scripts/ner-labels.mjs
 */
import { readFile } from 'node:fs/promises';

const REPO = 'onnx-community/gliner_small-v2.1';
const local = '.cache/gliner/model_int8.onnx';

const SETS = {
  current: ['person', 'organization', 'location', 'job title', 'medical condition', 'employee id', 'project codename'],
  memory: [
    'person', 'employer', 'school', 'city', 'street address', 'family member',
    'medical condition', 'job title', 'salary', 'phone number', 'email address', 'username',
  ],
};

const text = await readFile(process.env.NER_TEXT_FILE ?? 'scripts/sample-memory.txt', 'utf8');
const { Gliner } = await import('gliner/node');
const gliner = new Gliner({
  tokenizerPath: REPO,
  onnxSettings: { modelPath: new Uint8Array(await readFile(local)) },
  transformersSettings: { allowLocalModels: false, useBrowserCache: false },
  maxWidth: 12,
  modelType: 'span-level',
});
await gliner.initialize();

for (const [name, entities] of Object.entries(SETS)) {
  const t = Date.now();
  const out = await gliner.inference({ texts: [text], entities, flatNer: true, threshold: 0.4 });
  console.log(`\n== ${name} (${Date.now() - t}ms) ==`);
  for (const s of out[0] ?? []) console.log(`  ${s.label.padEnd(16)} ${String(Math.round(s.score * 100)).padStart(3)}%  "${s.spanText}"`);
}
