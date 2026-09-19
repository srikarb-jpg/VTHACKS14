/**
 * Lifecycle for the offscreen detection host.
 *
 * Chrome permits exactly one offscreen document per extension, and creating
 * a second throws. Creation is also racy: two messages arriving together
 * will both see "no document" and both try to create one. The in-flight
 * promise below is what serialises that.
 */
import type { OffscreenRequest, OffscreenResponse } from '../shared/ner';

const PATH = 'src/offscreen/index.html';

let creating: Promise<void> | null = null;

async function exists(): Promise<boolean> {
  // getContexts is the supported check; older channels lack it, so fall
  // back to assuming absent and letting the create() error tell us.
  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  return (contexts?.length ?? 0) > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (await exists()) return;
  if (creating) return creating;

  creating = chrome.offscreen
    .createDocument({
      url: PATH,
      // WORKERS is the closest documented reason for hosting an inference
      // runtime; there is no ML-specific reason in the enum.
      reasons: ['WORKERS' as chrome.offscreen.Reason],
      justification:
        'Runs local PII detection (ONNX/WebAssembly). Cannot run in a content script because the host page CSP forbids WebAssembly compilation, nor in the service worker because it is terminated when idle.',
    })
    .catch((err: unknown) => {
      // A concurrent create can still win the race; that is fine.
      if (!String(err).includes('Only a single offscreen')) throw err;
    })
    .finally(() => {
      creating = null;
    });

  return creating;
}

/**
 * Keepalive.
 *
 * Chrome tears down an offscreen document it believes is idle. For a page
 * whose entire purpose is to hold ~183 MB of model weights in memory, that
 * is ruinous: the next request pays the full reload, which measured at
 * ~18 seconds against 302 ms of actual inference.
 *
 * A periodic no-op message counts as activity and keeps it resident. The
 * interval has to be comfortably under the teardown window, and it is
 * cheap -- one message every 20 s.
 */
const KEEPALIVE_MS = 20_000;
let keepalive: ReturnType<typeof setInterval> | null = null;

function startKeepalive(): void {
  if (keepalive !== null) return;
  keepalive = setInterval(() => {
    void chrome.runtime
      .sendMessage({ type: 'ner:ping', target: 'offscreen' })
      .catch(() => {
        // The document is gone; stop pinging and let the next request
        // recreate it.
        if (keepalive !== null) clearInterval(keepalive);
        keepalive = null;
      });
  }, KEEPALIVE_MS);
}

/** Send a request to the offscreen host, starting it if necessary. */
export async function askOffscreen(req: OffscreenRequest): Promise<OffscreenResponse> {
  await ensureOffscreen();
  startKeepalive();
  return (await chrome.runtime.sendMessage({ ...req, target: 'offscreen' })) as OffscreenResponse;
}
