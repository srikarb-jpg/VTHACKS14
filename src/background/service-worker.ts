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

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
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
