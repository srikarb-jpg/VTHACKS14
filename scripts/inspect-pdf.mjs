// Local inspection only; source documents are never sent over the network.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [input, output = '.cache/pdf-inspection'] = process.argv.slice(2);
if (!input) throw new Error('Usage: node scripts/inspect-pdf.mjs input.pdf [output-directory]');
await mkdir(output, { recursive: true });
const task = getDocument({ data: new Uint8Array(await readFile(input)), useSystemFonts: true });
try {
  const doc = await task.promise;
  console.log(`${doc.numPages} page(s)`);
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1.5 });
    const target = doc.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({ canvas: target.canvas, canvasContext: target.context, viewport }).promise;
      await writeFile(`${output}/page-${n}.png`, Buffer.from(target.canvas.toDataURL('image/png').split(',')[1], 'base64'));
      console.log(`Page ${n}: ${(await page.getTextContent()).items.length} text items`);
    } finally { doc.canvasFactory.destroy(target); }
  }
} finally { await task.destroy(); }
