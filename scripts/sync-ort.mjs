/**
 * Copies ONNX Runtime's WASM binaries out of node_modules into public/ort/.
 *
 * They must be served by the extension rather than fetched from a CDN:
 * remote binaries would be a network dependency at inference time and
 * undercut the claim that detection is local.
 *
 * Not committed -- 31MB of reproducible build output. Runs on postinstall.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.jsep.wasm'];
const SRC = 'node_modules/onnxruntime-web/dist';

await mkdir('public/ort', { recursive: true });
for (const f of FILES) {
  if (!existsSync(`${SRC}/${f}`)) {
    console.warn(`[sync-ort] missing ${f} — is onnxruntime-web installed?`);
    continue;
  }
  await copyFile(`${SRC}/${f}`, `public/ort/${f}`);
  console.log(`[sync-ort] ${f}`);
}
