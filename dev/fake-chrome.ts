/**
 * A stand-in for the `chrome.*` APIs the popup and dashboard use, so both can
 * be built and reviewed in an ordinary browser tab with no extension loaded.
 *
 * Covers only what those two pages call. Do not grow it into a general mock.
 */
import type { Settings, UsageEvent } from '../src/shared/types';

export interface FakeOptions {
  /** URL of the "active tab". Omit to simulate a tab the browser will not name. */
  url?: string;
  enabled?: boolean;
  mode?: Settings['mode'];
  theme?: Settings['theme'];
  events: UsageEvent[];
}

export function installFakeChrome(opts: FakeOptions): void {
  let settings: Settings = {
    mode: opts.mode ?? 'autopilot',
    enabled: opts.enabled ?? true,
    nerEnabled: false,
    autoRedactNames: false,
    nerAutoRedactMinScore: 0.7,
    theme: opts.theme ?? 'light',
    policy: null,
  };

  const stub = {
    runtime: {
      sendMessage: async (msg: { type: string; patch?: Partial<Settings> }) => {
        switch (msg.type) {
          case 'settings:get':
            return { type: 'settings:value', settings };
          case 'settings:set':
            settings = { ...settings, ...msg.patch };
            return { type: 'settings:value', settings };
          case 'usage:query':
            return { type: 'usage:rows', events: opts.events };
          case 'ner:probe':
            return {
              type: 'ner:probe-result',
              probe: { wasm: true, webgpu: false, crossOriginIsolated: false, deviceMemoryGb: 16, error: null },
              loaded: false,
              error: null,
            };
          default:
            return { type: 'ok' };
        }
      },
      getManifest: () => ({ options_page: 'src/options/index.html' }),
      getURL: (p: string) => `/${p}`,
      openOptionsPage: () => console.info('[preview] open dashboard'),
    },
    tabs: {
      query: async () => (opts.url ? [{ url: opts.url }] : [{}]),
      create: (o: { url: string }) => console.info('[preview] open tab', o.url),
    },
    storage: { onChanged: { addListener: () => undefined } },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = stub;
}
