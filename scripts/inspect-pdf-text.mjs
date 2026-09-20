import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
const task = getDocument({ data: new Uint8Array(await readFile(process.argv[2])), useSystemFonts: true });
try {
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const operations = await page.getOperatorList();
  const names = Object.fromEntries(Object.entries(OPS).map(([key, value]) => [value, key]));
  await mkdir('.cache/pdf-inspection', { recursive: true });
  await writeFile('.cache/pdf-inspection/text.json', JSON.stringify({ content, operations: operations.fnArray.map((op, i) => ({ name: names[op], args: operations.argsArray[i] })) }, null, 2));
  console.log('Saved text and drawing operations locally for inspection.');
} finally { await task.destroy(); }
