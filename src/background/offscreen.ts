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

/** Send a request to the offscreen host, starting it if necessary. */
export async function askOffscreen(req: OffscreenRequest): Promise<OffscreenResponse> {
  await ensureOffscreen();
  return (await chrome.runtime.sendMessage({ ...req, target: 'offscreen' })) as OffscreenResponse;
}
