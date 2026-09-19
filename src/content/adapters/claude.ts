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
    if (!this.selectAll(el)) return false;

    // Strategy 1: execCommand. Deprecated, still the most compatible path
    // into ProseMirror's own input handling.
    if (document.execCommand('insertText', false, text)) {
      if (this.verify(text)) return true;
    }

    // Strategy 2: synthetic paste with a real DataTransfer. ProseMirror has a
    // dedicated paste handler, so this survives when execCommand is disabled.
    this.selectAll(el);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasted = el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    if (pasted !== false && this.verify(text)) return true;

    // Strategy 3: beforeinput with insertReplacementText. Last resort; some
    // ProseMirror builds honour it where the two above are blocked.
    this.selectAll(el);
    el.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertReplacementText',
        data: text,
        bubbles: true,
        cancelable: true,
      }),
    );
    if (this.verify(text)) return true;

    // Every strategy failed. Report it -- the caller must abort the send
    // rather than let the original text through.
    console.error('[prompt-firewall] all composer write strategies failed');
    return false;
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

  /**
   * Confirms the write actually landed. Without this we could believe a
   * redaction succeeded when the composer still holds the original text,
   * which is precisely the failure mode that leaks data.
   */
  private verify(expected: string): boolean {
    return this.readText().replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim();
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
