/**
 * Config sweep. GLiNER's span-level cost scales with
 *   (number of candidate spans) x (number of entity labels)
 * so maxWidth and the label list are the two biggest levers we control
 * without changing model or backend. This measures them.
 */
import { readFile } from 'node:fs/promises';

const REPO = 'onnx-community/gliner_small-v2.1';
const local = '.cache/gliner/model_int8.onnx';
const TEXT =
  'Hi, Amanda Britfield was my manager at Microsoft in Seattle before she moved to ' +
  'Contoso Health as director of engineering. Her colleague Dr. Raj Patel still works there.';

const ALL = ['person', 'organization', 'location', 'job title', 'medical condition', 'employee id', 'project codename'];
const CORE = ['person', 'organization', 'location'];
const MIN = ['person', 'organization'];

const { Gliner } = await import('gliner/node');
const bytes = new Uint8Array(await readFile(local));

async function bench(label, entities, maxWidth) {
  const g = new Gliner({
    tokenizerPath: REPO,
    onnxSettings: { modelPath: bytes },
    transformersSettings: { allowLocalModels: false, useBrowserCache: false },
    maxWidth,
    modelType: 'span-level',
  });
  await g.initialize();
  // warm
  await g.inference({ texts: [TEXT], entities, flatNer: true, threshold: 0.4 });
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    const out = await g.inference({ texts: [TEXT], entities, flatNer: true, threshold: 0.4 });
    runs.push(Date.now() - t);
    if (i === 0) var found = (out[0] ?? []).length;
  }
  runs.sort((a, b) => a - b);
  console.log(
    `${label.padEnd(34)} median ${String(runs[2]).padStart(5)}ms   ` +
      `min ${String(runs[0]).padStart(4)}ms   ${found} spans`,
  );
}

console.log(`text: ${TEXT.length} chars\n`);
// maxWidth is baked into the exported graph (span_rep_layer reshape), so 12
// is the only valid value for this checkpoint. Labels are the one lever.
await bench(`7 labels (current)`, ALL, 12);
await bench(`3 labels`, CORE, 12);
await bench(`2 labels`, MIN, 12);
await bench(`1 label`, ['person'], 12);
