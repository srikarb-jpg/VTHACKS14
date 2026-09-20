// Process a local PDF with the extension's rule-based attachment path.
// GLiNER requires the extension's offscreen host and is not used by this CLI.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/redact-pdf-local.mjs input.pdf output.pdf');
await build({ configFile: false, logLevel: 'error', build: {
  outDir: '.cache/pdf-cli', emptyOutDir: false, minify: false,
  lib: { entry: 'src/content/attachments.ts', formats: ['es'], fileName: 'attachments' },
  rollupOptions: { external: (id) => id === 'pdf-lib' || id.startsWith('pdfjs-dist/') },
} });
{
  const { scrubAttachment } = await import(pathToFileURL(resolve('.cache/pdf-cli/attachments.js')).href);
  const result = await scrubAttachment(new File([await readFile(input)], basename(input), { type: 'application/pdf' }));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, new Uint8Array(await result.file.arrayBuffer()));
  console.log(`Wrote redacted PDF (${result.placeholders.length} distinct values).`);
}
