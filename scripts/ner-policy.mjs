/**
 * Does typed policy work? Zero-shot GLiNER on plain-English category names,
 * scored against known answers. Synthetic text only -- every value below is
 * made up.
 *
 *   node scripts/ner-policy.mjs
 */
import { readFile } from 'node:fs/promises';

const REPO = 'onnx-community/gliner_small-v2.1';
const THRESHOLD = Number(process.env.NER_THRESHOLD ?? 0.4);

// Each answer is [category, exact text]. `label` per set maps category -> label string.
const CASES = [
  { text: 'Our proposal for contract W15P7T-19-D-0042 is due Friday, and the customer wants Project Falcon demoed before launch.',
    want: [['contract', 'W15P7T-19-D-0042'], ['codename', 'Project Falcon']] },
  { text: 'The subcontract FA8750-21-C-0113 covers the Bluebird radar upgrade.',
    want: [['contract', 'FA8750-21-C-0113'], ['system', 'Bluebird radar']] },
  { text: 'Jordan holds a Top Secret clearance and works out of the Reston facility.',
    want: [['clearance', 'Top Secret']] },
  { text: 'We plan to acquire Northwind Analytics for $48 million next quarter, so keep this quiet.',
    want: [['target', 'Northwind Analytics'], ['amount', '$48 million']] },
  { text: 'Patient MRN 00482913 was admitted overnight and is being treated for pneumonia.',
    want: [['mrn', '00482913']] },
  { text: 'SSH into db-prod-03.internal.contoso.net and restart the payroll job.',
    want: [['host', 'db-prod-03.internal.contoso.net']] },
  { text: 'Her salary is $135,000 and the bonus target is twelve percent.',
    want: [['salary', '$135,000']] },
  { text: 'Employee E-448291 needs access to the finance share by Monday.',
    want: [['empid', 'E-448291']] },
  { text: 'Codename Lantern is the internal name for the Q3 pricing overhaul.',
    want: [['codename', 'Lantern']] },
];
const CLEAN = [
  'Can you explain how binary search works and give an example in Python?',
  'What is the boiling point of ethanol in Celsius?',
  'Please rewrite this paragraph so it is more concise and formal.',
  'Write a function that merges two sorted lists.',
];

const SETS = {
  'plain english': {
    contract: 'contract number', codename: 'unreleased product codename', system: 'weapons system name',
    clearance: 'security clearance level', target: 'acquisition target', amount: 'monetary amount',
    mrn: 'patient medical record number', host: 'internal server hostname', salary: 'salary', empid: 'employee id',
  },
  'short terms': {
    contract: 'contract number', codename: 'codename', system: 'system name',
    clearance: 'clearance', target: 'company', amount: 'amount',
    mrn: 'MRN', host: 'hostname', salary: 'salary', empid: 'employee id',
  },
};

const { Gliner } = await import('gliner/node');
const gliner = new Gliner({
  tokenizerPath: REPO,
  onnxSettings: { modelPath: new Uint8Array(await readFile('.cache/gliner/model_int8.onnx')) },
  transformersSettings: { allowLocalModels: false, useBrowserCache: false },
  maxWidth: 12,
  modelType: 'span-level',
});
await gliner.initialize();

for (const [setName, labels] of Object.entries(SETS)) {
  const entities = [...new Set(Object.values(labels))];
  const byLabel = Object.fromEntries(Object.entries(labels).map(([k, v]) => [v, k]));
  let hitRight = 0, hitAnyLabel = 0, total = 0, falsePos = 0, preds = 0;
  const perCat = {};
  console.log(`\n=== ${setName} (threshold ${THRESHOLD}) ===`);

  const out = await gliner.inference({ texts: CASES.map((c) => c.text), entities, flatNer: true, threshold: THRESHOLD });
  CASES.forEach((c, i) => {
    const got = out[i] ?? [];
    for (const [cat, str] of c.want) {
      total++;
      perCat[cat] ??= { hit: 0, n: 0 };
      perCat[cat].n++;
      const anyLabel = got.find((s) => s.spanText.includes(str) || str.includes(s.spanText));
      const right = got.find((s) => byLabel[s.label] === cat && (s.spanText.includes(str) || str.includes(s.spanText)));
      if (anyLabel) hitAnyLabel++;
      if (right) { hitRight++; perCat[cat].hit++; }
      console.log(`  ${right ? 'OK  ' : anyLabel ? 'LBL ' : 'MISS'} ${cat.padEnd(9)} "${str}"${right ? ` (${Math.round(right.score * 100)}%)` : anyLabel ? ` -> labelled "${anyLabel.label}"` : ''}`);
    }
    for (const s of got) {
      preds++;
      const isWanted = c.want.some(([, str]) => s.spanText.includes(str) || str.includes(s.spanText));
      if (!isWanted) { falsePos++; console.log(`  FP   ${s.label} "${s.spanText}" ${Math.round(s.score * 100)}%`); }
    }
  });
  const clean = await gliner.inference({ texts: CLEAN, entities, flatNer: true, threshold: THRESHOLD });
  let cleanFp = 0;
  clean.forEach((spans, i) => spans.forEach((s) => { cleanFp++; console.log(`  FP on clean text: ${s.label} "${s.spanText}" ${Math.round(s.score * 100)}%  [${CLEAN[i].slice(0, 40)}]`); }));
  console.log(`  -> recall (right label) ${hitRight}/${total}, (any label) ${hitAnyLabel}/${total}; false positives in cases ${falsePos}, on clean text ${cleanFp}`);
  console.log('  per category:', Object.entries(perCat).map(([k, v]) => `${k} ${v.hit}/${v.n}`).join(', '));
}
