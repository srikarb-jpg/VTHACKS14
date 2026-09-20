/**
 * Inline highlights, drawn as an overlay rather than injected into the text.
 *
 * The naive approach -- wrap matched text in <span> inside the composer --
 * breaks a ProseMirror contenteditable. ProseMirror owns that subtree and
 * reconciles it against its own document model; foreign nodes get reverted,
 * or worse, desync the model so the text the user sees is not the text that
 * gets sent.
 *
 * So we never touch the composer. Instead:
 *
 *   1. Map the finding's character offsets to a DOM Range (textmap.ts).
 *   2. Ask the browser where that Range physically is: getClientRects().
 *      One rect per line fragment, so wrapped text is handled for free.
 *   3. Draw absolutely-positioned bars at those viewport coordinates inside
 *      our own shadow-root layer.
 *
 * The composer is untouched, the editor cannot fight us, and line wrapping,
 * font changes and zoom all work because the browser did the layout.
 *
 * Cost: the rects are viewport coordinates, so anything that moves the text
 * -- scrolling, resizing, editing -- invalidates them and we must redraw.
 */
import type { LiveFinding } from '../../worker/incremental';
import type { TextMap } from '../textmap';
import { offsetToRange } from '../textmap';
import { getLayer } from './shell';

const SEVERITY_COLOR: Record<string, string> = {
  block: '#ff5d5d',
  high: '#ffa62b',
  medium: '#6f9eff',
  low: '#8b93a1',
};

let host: HTMLElement | null = null;
let onPick: ((f: LiveFinding) => void) | null = null;

function ensureHost(): HTMLElement {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  // pointer-events:none so the layer as a whole never intercepts clicks,
  // typing or text selection. Individual bars opt back in below.
  host.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  host.setAttribute('data-pf-passive', '');
  getLayer().append(host);
  return host;
}

export function setHighlightHandler(fn: (f: LiveFinding) => void): void {
  onPick = fn;
}

/**
 * Redraw every highlight. Cheap enough to call on each scan and on scroll:
 * getClientRects is a layout read, and we do one per finding, not per
 * character.
 */
export function renderHighlights(map: TextMap, findings: LiveFinding[]): void {
  const layer = ensureHost();
  const bars: HTMLElement[] = [];

  for (const f of findings) {
    const range = offsetToRange(map, f.start, f.end);
    if (!range) continue;

    const color = SEVERITY_COLOR[f.severity] ?? SEVERITY_COLOR.low ?? '#8b93a1';

    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 1 || rect.height < 1) continue;

      const bar = document.createElement('div');
      bar.style.cssText =
        `position:fixed;left:${rect.left}px;top:${rect.bottom - 2}px;` +
        `width:${rect.width}px;height:2px;border-radius:2px;` +
        // Settled findings get a solid underline; provisional ones a faint
        // dashed rule, so the user can see the detector tracking something
        // without being told it has decided.
        (f.settled
          ? `background:${color};opacity:.95;`
          : `background:repeating-linear-gradient(90deg,${color} 0 3px,transparent 3px 6px);opacity:.5;`);

      if (f.confirmed) {
        // Confirmed: this WILL be replaced on send. Drawn as a filled band
        // rather than a rule, so it reads as decided rather than suggested.
        bar.style.cssText =
          `position:fixed;left:${rect.left}px;top:${rect.top}px;` +
          `width:${rect.width}px;height:${rect.height}px;border-radius:3px;` +
          `background:${color};opacity:.22;`;
      }

      if (f.settled) {
        // Only the underline strip is interactive, and only once settled.
        // It sits below the text baseline, so it almost never steals a click
        // meant for placing the caret.
        bar.style.pointerEvents = 'auto';
        bar.style.cursor = 'pointer';
        if (!f.confirmed) bar.style.height = '3px';
        bar.title =
          f.severity === 'low'
            ? f.confirmed
              ? `${f.label} — will be replaced on send. Click to undo.`
              : `${f.label} — click to replace this on send`
            : `${f.label} — always replaced automatically`;
        bar.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onPick?.(f);
        });
      }

      bars.push(bar);
    }
  }

  layer.replaceChildren(...bars);
}

export function clearHighlights(): void {
  host?.replaceChildren();
}

export function destroyHighlights(): void {
  host?.remove();
  host = null;
}
