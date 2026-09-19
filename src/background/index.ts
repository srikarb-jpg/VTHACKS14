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

    case 'badge:increment':
      if (tabId !== undefined) badge.increment(tabId, msg.redactions, msg.reroutes);
      return { type: 'ok' };

    default: {
      const unreachable: never = msg;
      throw new Error(`unhandled message: ${JSON.stringify(unreachable)}`);
    }
  }
}

chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
  handle(msg, sender.tab?.id)
    .then(sendResponse)
    .catch((err: unknown) => {
      console.error('[prompt-firewall] background error', err);
      sendResponse({ type: 'ok' } satisfies FromBackground);
    });
  // Keeps the message channel open for the async response.
  return true;
});
