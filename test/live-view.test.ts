import { beforeEach, describe, expect, it } from 'vitest';
import { buildLiveView } from '../src/content/live-view';
import { clearConfirmed, toggleConfirmed } from '../src/content/confirmed';
import { scan } from '../src/worker/detectors';
import { nerSpansToFindings } from '../src/worker/ner-map';

const TEXT = 'Amanda Britfield was my manager at Microsoft. Reach her at amanda@contoso.com today.';
const spans = [{ start: 0, end: 16, label: 'person', score: 0.93, text: 'Amanda Britfield' }];

const regex = () => scan(TEXT).findings;
const ner = () => nerSpansToFindings(spans, TEXT);

beforeEach(() => clearConfirmed());

describe('buildLiveView', () => {
  it('keeps the model findings on a repaint after the model has finished', () => {
    // Regression: a keyup/caret scan after the model finished repainted from
    // regex alone, so names vanished until the next edit.
    const view = buildLiveView({ regex: regex(), ner: ner(), nerFor: TEXT, text: TEXT, caret: 3, settleAll: false });
    expect(view.some((f) => f.value === 'Amanda Britfield')).toBe(true);
    expect(view.some((f) => f.kind === 'email')).toBe(true);
  });

  it('drops model findings computed for different text', () => {
    const view = buildLiveView({ regex: regex(), ner: ner(), nerFor: 'older text', text: TEXT, caret: null, settleAll: false });
    expect(view.some((f) => f.value === 'Amanda Britfield')).toBe(false);
  });

  it('keeps a confirmed name visible, marked confirmed, after clicking it', () => {
    // Regression: clicking "Click to replace" re-scanned, the row vanished
    // and the panel said "Nothing sensitive so far".
    const name = ner()[0]!;
    toggleConfirmed(name);
    const view = buildLiveView({ regex: regex(), ner: ner(), nerFor: TEXT, text: TEXT, caret: null, settleAll: false });
    const row = view.find((f) => f.value === 'Amanda Britfield');
    expect(row).toBeDefined();
    expect(row?.confirmed).toBe(true);
  });

  it('settles a finding at the very end of a paste', () => {
    const pasted = 'sk-ant-api03-Xq7Rm2LpVn4Tz8Kw1Yb6Jd3Hs5Gf9Cc0Ae2Bi4Nu7Ok1Pl8Qm3Rt6Uv9Wx2Zy5A';
    const input = { regex: scan(pasted).findings, ner: [], nerFor: pasted, text: pasted, caret: pasted.length };
    expect(buildLiveView({ ...input, settleAll: false })[0]?.settled).toBe(false);
    expect(buildLiveView({ ...input, settleAll: true })[0]?.settled).toBe(true);
  });
});
