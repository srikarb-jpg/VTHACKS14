/**
 * Fake data for the UI harness. Keep these shapes identical to what the
 * content script passes, so a component that looks right here looks right
 * in situ.
 */
import { showToast } from '../src/content/ui/toast';
import { showDiff, closeDiff } from '../src/content/ui/diff';
import { showBlockPanel } from '../src/content/ui/cui-block';
import { scan } from '../src/worker/detectors';
import { redact, revertOne } from '../src/worker/redact';
import type { Placeholder } from '../src/shared/types';
import { buildTextMap } from '../src/content/textmap';
import { renderHighlights, setHighlightHandler } from '../src/content/ui/highlights';
import { renderLive } from '../src/content/ui/live';
import { IncrementalScanner, markSettled } from '../src/worker/incremental';
import { wrapToken } from '../src/shared/config';

const SAMPLE = `Can you help me debug this? Customer Dana Whitfield (dana.whitfield@northlake-health.org, 540-555-0142) says the sync fails. Our key is sk-ant-api03-Xq7Rm2LpVn4Tz8Kw1Yb6Jd3Hs5Gf9Cc0Ae2Bi4Nu7Ok1Pl8Qm3Rt6Uv9Wx2Zy5A and the call 500s.`;

const MARKED = `CONTROLLED UNCLASSIFIED INFORMATION

(U//FOUO) Summarize the vendor assessment in section 3.`;

function buildDiff(): void {
  const r = redact(SAMPLE, scan(SAMPLE).findings);
  let text = r.redacted;
  let left: Placeholder[] = [...r.placeholders];
  const render = (): void =>
    showDiff({
      original: r.original,
      redacted: text,
      placeholders: left,
      onRevert: (token) => {
        const p = left.find((x) => x.token === token);
        if (!p) return;
        text = revertOne(text, p);
        left = left.filter((x) => x.token !== token);
        render();
      },
      onClose: closeDiff,
    });
  render();
}

const actions: Record<string, () => void> = {
  toast: () => {
    const r = redact(SAMPLE, scan(SAMPLE).findings);
    showToast({
      placeholders: r.placeholders,
      onUndo: () => console.info('undo'),
      onOpenDiff: buildDiff,
    });
  },
  diff: buildDiff,
  block: () =>
    showBlockPanel({
      findings: scan(MARKED).findings.filter((f) => f.severity === 'block'),
      onDismiss: () => console.info('dismissed'),
    }),
};

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-show]')) {
  btn.addEventListener('click', () => actions[btn.dataset.show ?? '']?.());
}


// ---------------------------------------------------------------------------
// Live highlight playground.
//
// Exercises the real code paths -- same text map, same scanner, same overlay
// renderer -- against a plain contenteditable, so highlighting can be built
// and judged without a chat site in the loop.
// ---------------------------------------------------------------------------

const composer = document.getElementById('composer');

if (composer) {
  const scanner = new IncrementalScanner((t) => scan(t).findings);

  const caretOffset = (): number | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!composer.contains(range.startContainer)) return null;
    const probe = document.createRange();
    probe.selectNodeContents(composer);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length;
  };

  let lastMap = buildTextMap(composer);
  let lastLive = markSettled([], '', null);

  const refresh = (): void => {
    const map = buildTextMap(composer);
    const text = map.text.trimEnd();
    const { findings, stats } = scanner.scan(text);
    const live = markSettled(findings, text, caretOffset());
    lastMap = map;
    lastLive = live;
    renderHighlights(map, live);
    renderLive(live, stats, text.length);
  };

  let timer: number | undefined;
  const schedule = (delay: number): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, delay);
  };

  composer.addEventListener('input', () => schedule(180));
  composer.addEventListener('keyup', () => schedule(60));
  composer.addEventListener('mouseup', () => schedule(0));
  window.addEventListener('scroll', () => renderHighlights(lastMap, lastLive), {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', () => renderHighlights(lastMap, lastLive), { passive: true });

  setHighlightHandler((f) => {
    const text = buildTextMap(composer).text;
    const next = text.slice(0, f.start) + wrapToken(`${f.kind.toUpperCase()}_1`) + text.slice(f.end);
    composer.textContent = next;
    refresh();
  });

  refresh();
}
