/**
 * Service worker entry: the single message listener, and nothing else.
 *
 * Every branch must be exhaustive over ToBackground -- the `never` check at
 * the bottom is what turns "someone added a message type and forgot the
 * handler" from a 2am debugging session into a compile error.
 */
import type { FromBackground, ToBackground } from '../shared/messages';
import * as badge from './badge';
import * as settings from './settings';
import * as usage from './usage';
import * as vault from './vault';
import { askOffscreen } from './offscreen';
import { SUPPORTED_HOSTS } from '../shared/config';

// The toolbar button opens the popup (manifest: action.default_popup), which
// links to the dashboard. An onClicked handler would never fire alongside a
// popup, so there is none.

/**
 * Preload the model.
 *
 * The first load costs ~16 s: reading ~183 MB back and having ONNX Runtime
 * build an InferenceSession from it. That cost is unavoidable, but WHEN it
 * is paid is entirely up to us, and paying it while the user is mid-sentence
 * is the worst possible choice.
 *
 * So we start it as soon as we have any reason to think it will be wanted:
 * at browser startup, on install, and whenever a supported chat page opens.
 * By the time anyone has typed a sentence it is resident, and the keepalive
 * holds it there.
 *
 * Deliberately only when the user has already opted in -- this must never
 * trigger the download on its own.
 */
async function preloadIfEnabled(why: string): Promise<void> {
  const s = await settings.get();
  if (!s.enabled || !s.nerEnabled) return;
  console.info(`[prompt-firewall] preloading model (${why})`);
  const t0 = performance.now();
  const r = await askOffscreen({ type: 'ner:load' });
  console.info(
    `[prompt-firewall] preload ${r.type === 'ner:loaded' && r.ok ? 'ready' : 'failed'} ` +
      `in ${(performance.now() - t0).toFixed(0)}ms`,
  );
}

chrome.runtime.onStartup.addListener(() => void preloadIfEnabled('browser startup'));
chrome.runtime.onInstalled.addListener(() => void preloadIfEnabled('install/update'));

// A supported chat page opening is the strongest signal the model is about
// to be needed.
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status !== 'loading' || !tab.url) return;
  if (!SUPPORTED_HOSTS.some((h) => tab.url?.includes(h))) return;
  void preloadIfEnabled('chat page opened');
});

async function handle(msg: ToBackground, tabId: number | undefined): Promise<FromBackground> {
  switch (msg.type) {
    case 'vault:put':
      if (tabId !== undefined) vault.put(tabId, msg.placeholders);
      return { type: 'ok' };

    case 'vault:get':
      return { type: 'vault:contents', placeholders: tabId === undefined ? [] : vault.get(tabId) };

    case 'vault:clear':
      if (tabId !== undefined) vault.clear(tabId);
      return { type: 'ok' };

    case 'usage:record':
      await usage.record(msg.event);
      return { type: 'ok' };

    case 'usage:query':
      return { type: 'usage:rows', events: await usage.since(msg.sinceMs) };

    case 'settings:get':
      return { type: 'settings:value', settings: await settings.get() };

    case 'settings:set':
      return { type: 'settings:value', settings: await settings.set(msg.patch) };

    case 'ner:probe': {
      const r = await askOffscreen({ type: 'ner:probe' });
      return r.type === 'ner:probe-result'
        ? r
        : {
            type: 'ner:probe-result',
            probe: {
              wasm: false,
              webgpu: false,
              crossOriginIsolated: false,
              deviceMemoryGb: null,
              error: 'offscreen unavailable',
            },
            loaded: false,
            error: 'offscreen unavailable',
          };
    }

    case 'ner:load': {
      const r = await askOffscreen({ type: 'ner:load' });
      return r.type === 'ner:loaded'
        ? r
        : { type: 'ner:loaded', ok: false, error: r.type === 'ner:error' ? r.error : 'unexpected' };
    }

    case 'ner:selftest': {
      const r = await askOffscreen({ type: 'ner:selftest' });
      return r.type === 'ner:selftest-result'
        ? r
        : {
            type: 'ner:selftest-result',
            ms: 0,
            spans: [],
            provider: 'none',
            error: r.type === 'ner:error' ? r.error : 'unexpected',
          };
    }

    case 'ner:detect': {
      // Timed here so the content script can tell model cost apart from
      // messaging cost. A cold service worker or a stalled offscreen
      // document shows up as roundTrip >> infer.
      const t0 = performance.now();
      const r = await askOffscreen({ type: 'ner:detect', texts: msg.texts, threshold: msg.threshold });
      const roundTripMs = performance.now() - t0;
      return r.type === 'ner:spans'
        ? { ...r, roundTripMs }
        : {
            type: 'ner:spans',
            spans: [],
            inferMs: 0,
            loadMs: 0,
            bootId: 'none',
            roundTripMs,
            error: r.type === 'ner:error' ? r.error : 'unexpected',
          };
    }

    case 'badge:increment':
      if (tabId !== undefined) badge.increment(tabId, msg.redactions, msg.reroutes);
      return { type: 'ok' };

    default: {
      const unreachable: never = msg;
      throw new Error(`unhandled message: ${JSON.stringify(unreachable)}`);
    }
  }
}

chrome.runtime.onMessage.addListener((msg: ToBackground & { target?: string }, sender, sendResponse) => {
  // chrome.runtime.sendMessage broadcasts to EVERY extension context, this
  // one included. Messages we address to the offscreen document carry a
  // target, and without this guard the background would receive its own
  // 'ner:*' message, handle it, and call askOffscreen again -- forever.
  if (msg.target === 'offscreen') return undefined;

  handle(msg, sender.tab?.id)
    .then(sendResponse)
    .catch((err: unknown) => {
      console.error('[prompt-firewall] background error', err);
      sendResponse({ type: 'ok' } satisfies FromBackground);
    });
  // Keeps the message channel open for the async response.
  return true;
});
