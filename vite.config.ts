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
      // The harness is a dev page, but building it keeps it from silently
      // rotting when a component signature changes.
      input: { harness: 'dev/harness.html' },
    },
  },
  server: {
    // crxjs needs a stable port for its HMR client inside the content script.
    port: 5173,
    strictPort: true,
  },
});
