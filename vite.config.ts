import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    // Source maps are worth the build time at 3am.
    sourcemap: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        // The offscreen document's URL is passed to chrome.offscreen at
        // runtime, so it never appears in the manifest and crxjs does not
        // discover it. Without this entry it is silently absent from the
        // build and createDocument fails with a 404.
        offscreen: 'src/offscreen/index.html',
        // The harness is a dev page, but building it keeps it from silently
        // rotting when a component signature changes.
        harness: 'dev/harness.html',
        // Popup and dashboard against a fake chrome API, for reviewing the layout.
        preview: 'dev/preview.html',
        // A fake thread for hover rehydration: a duplicated message and a
        // streaming reply, which is what broke the reveal overlay.
        revealLab: 'dev/reveal-lab.html',
      },
    },
  },
  server: {
    // crxjs needs a stable port for its HMR client inside the content script.
    port: 5173,
    strictPort: true,
  },
});
