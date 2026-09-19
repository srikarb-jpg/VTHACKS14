/**
 * Fake data for the UI harness. Keep these shapes identical to what the
 * content script passes, so a component that looks right here looks right
 * in situ.
 */
import { showToast } from '../src/content/ui/toast';
import { showDiff, closeDiff } from '../src/content/ui/diff';
import { showBlockPanel } from '../src/content/ui/cui-block';
import { showChip } from '../src/content/ui/chip';
import { scan } from '../src/worker/detectors';
import { redact, revertOne } from '../src/worker/redact';
import type { Placeholder } from '../src/shared/types';

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
  chip: () =>
    showChip(
      {
        decision: {
          lane: 'searchable',
          confidence: 0.9,
          reason: 'Looks like a factual lookup',
          source: 'rules',
        },
        onAccept: () => console.info('accepted'),
        onDismiss: () => console.info('dismissed'),
      },
      document.querySelector<HTMLElement>('.bar'),
    ),
};

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-show]')) {
  btn.addEventListener('click', () => actions[btn.dataset.show ?? '']?.());
}
