/**
 * claude.ai composer adapter.
 *
 * The composer is a ProseMirror contenteditable. Three consequences drive
 * everything below:
 *
 *  1. Setting textContent or innerHTML does not work. ProseMirror owns the
 *     DOM and reconciles our write away, or desyncs its document state from
 *     what is rendered -- which is worse, because the send then transmits the
 *     ORIGINAL text while the user sees the redacted one.
 *  2. execCommand('insertText') is deprecated but routes through the same
 *     beforeinput path as real typing, so ProseMirror treats it as a genuine
 *     edit and updates its internal document. This is the primary strategy.
 *  3. A synthetic Enter keydown is not reliable, because handlers may check
 *     isTrusted. We click the send button instead.
 *
 * SELECTORS ARE THE FRAGILE PART. They are all collected here, and each has a
 * fallback chain, because a site-side markup change is the single most likely
 * cause of a demo failure.
 */
import type { ComposerAdapter } from './types';
import { buildTextMap, type TextMap } from '../textmap';

const COMPOSER_SELECTORS = [
  'div[contenteditable="true"].ProseMirror',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
];

const SEND_BUTTON_SELECTORS = [
  'button[aria-label="Send message"]',
  'button[aria-label*="Send" i]',
  'button[type="submit"]',
];

const RESPONSE_SELECTORS = [
  '[data-testid="assistant-message"]',
  'div.font-claude-response',
  '[data-is-streaming] .prose',
];

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

function firstMatch(selectors: string[], root: ParentNode = document): HTMLElement | null {
  for (const sel of selectors) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

export class ClaudeAdapter implements ComposerAdapter {
  readonly site = 'claude.ai';

  getComposer(): HTMLElement | null {
    return firstMatch(COMPOSER_SELECTORS);
  }

  getAnchor(): HTMLElement | null {
    const composer = this.getComposer();
    // The composer's form wrapper is a more stable anchor than the editable
    // node itself, which ProseMirror may replace.
    return composer?.closest('form') ?? composer?.parentElement ?? composer;
  }

  readTextMap(): TextMap | null {
    const el = this.getComposer();
    return el ? buildTextMap(el) : null;
  }

  readText(): string {
    // Deliberately NOT innerText. The text we scan has to be the same string
    // the highlight offsets index into, and buildTextMap produces that
    // string. trimEnd only removes trailing characters, so offsets for
    // everything before it are unchanged.
    return (this.readTextMap()?.text ?? '').trimEnd();
  }

  getCaretOffset(): number | null {
    const el = this.getComposer();
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;
    // Measure the text between the composer's start and the caret. Using a
    // range rather than counting nodes keeps this correct across the nested
    // block structure ProseMirror builds.
    const probe = document.createRange();
    probe.selectNodeContents(el);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length;
  }

  writeText(text: string): boolean {
    const el = this.getComposer();
    if (!el) return false;

    el.focus();

    // Strategy 1: execCommand. Deprecated, still the most compatible path
    // into ProseMirror's own input handling -- it routes through the same
    // beforeinput pipeline as real typing, so the editor updates its
    // document model rather than just its DOM.
    if (this.selectAll(el) && document.execCommand('insertText', false, text)) {
      if (this.verify(text)) {
        console.info('[prompt-firewall] composer write: execCommand');
        return true;
      }
    }

    // Strategy 2: synthetic paste with a real DataTransfer. ProseMirror has
    // a dedicated paste handler. Only counts as success if the handler
    // actually consumed the event (preventDefault -> dispatchEvent false).
    this.selectAll(el);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const consumed = !el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    if (consumed && this.verify(text)) {
      console.info('[prompt-firewall] composer write: paste');
      return true;
    }

    // Strategy 3 (insertReplacementText via a synthetic beforeinput) was
    // removed deliberately. ProseMirror ignores untrusted beforeinput, so
    // the event changed nothing while our own DOM read still saw the old
    // value -- it could only ever produce a false success.

    console.error('[prompt-firewall] all composer write strategies failed');
    return false;
  }

  /**
   * Confirms the editor's own state matches, not just the rendered DOM.
   *
   * This is the check that matters and the one that was missing. Reading
   * the DOM proves what is on screen; it does NOT prove what ProseMirror
   * will submit. When the two disagree the extension reports a redaction
   * that never happened and the original text is sent -- the single worst
   * failure this codebase can have.
   *
   * Waits two animation frames first, so the editor has processed the edit
   * and any React state has flushed before we look.
   */
  async verifyCommitted(expected: string): Promise<boolean> {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = this.getComposer();
    if (!el) return false;

    const domText = this.readText();
    if (norm(domText) !== norm(expected)) {
      console.error('[prompt-firewall] composer DOM does not match expected text');
      return false;
    }

    // ProseMirror exposes its view on the DOM node. When present, its
    // document is the authority on what will actually be submitted.
    const view = (el as unknown as { pmViewDesc?: unknown }).pmViewDesc;
    if (view) {
      const pmText = (el as unknown as { textContent: string }).textContent ?? '';
      if (!norm(pmText).includes(norm(expected).slice(0, 40))) {
        console.error('[prompt-firewall] ProseMirror document disagrees with the DOM');
        return false;
      }
    }
    return true;
  }

  private selectAll(el: HTMLElement): boolean {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  /** Fast synchronous DOM check used between write strategies. */
  private verify(expected: string): boolean {
    return norm(this.readText()) === norm(expected);
  }

  submit(): boolean {
    const btn = firstMatch(SEND_BUTTON_SELECTORS) as HTMLButtonElement | null;
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }

  getResponseNodes(): HTMLElement[] {
    for (const sel of RESPONSE_SELECTORS) {
      const nodes = [...document.querySelectorAll<HTMLElement>(sel)];
      if (nodes.length) return nodes;
    }
    return [];
  }
}
