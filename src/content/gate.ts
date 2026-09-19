/**
 * The submit gate. This is the choke point the whole product is built on.
 *
 * We listen in the CAPTURE phase on window, so we run before the site's own
 * handlers, and we stopImmediatePropagation() to keep them from firing while
 * we decide. Nothing here is async before the decision to hold: the scan runs
 * synchronously so that a clean prompt is indistinguishable from no extension
 * at all.
 *
 * Re-entry guard: after scrubbing we send programmatically, which fires the
 * same listeners again. We guard with a module-level flag rather than a
 * property on the event, because synthetic events lose custom properties on
 * the way through ProseMirror.
 */
import type { ComposerAdapter } from './adapters/types';

export type GateVerdict = 'send' | 'hold' | 'cancel';

export interface GateHandlers {
  /**
   * Called with the composer text. Return 'send' to let the original through
   * untouched, 'hold' when the handler will perform the send itself once it
   * has finished (e.g. after redacting), or 'cancel' to drop the send.
   */
  onSubmitAttempt(text: string): GateVerdict;
}

export class SubmitGate {
  private replaying = false;
  private attached = false;

  constructor(
    private readonly adapter: ComposerAdapter,
    private readonly handlers: GateHandlers,
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeydown, { capture: true });
    window.addEventListener('click', this.onClick, { capture: true });
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeydown, { capture: true });
    window.removeEventListener('click', this.onClick, { capture: true });
  }

  /**
   * Performs a send that must not be re-intercepted. Everything that sends
   * programmatically goes through here.
   */
  sendWithoutIntercepting(): boolean {
    this.replaying = true;
    try {
      return this.adapter.submit();
    } finally {
      // Released on the next task so the click's own event loop turn is
      // covered; a microtask is not enough.
      setTimeout(() => {
        this.replaying = false;
      }, 0);
    }
  }

  private isSendKey(e: KeyboardEvent): boolean {
    // Shift+Enter inserts a newline on every site we support, so it is never
    // a send. Cmd/Ctrl+Enter is a send on some, and harmless to treat as one.
    return e.key === 'Enter' && !e.shiftKey && !e.isComposing;
  }

  private inComposer(target: EventTarget | null): boolean {
    const composer = this.adapter.getComposer();
    return !!composer && target instanceof Node && composer.contains(target);
  }

  private onKeydown = (e: KeyboardEvent): void => {
    if (this.replaying || !this.isSendKey(e) || !this.inComposer(e.target)) return;
    this.intercept(e);
  };

  private onClick = (e: MouseEvent): void => {
    if (this.replaying) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('button');
    if (!btn) return;
    const label = (btn.getAttribute('aria-label') ?? '').toLowerCase();
    if (!label.includes('send')) return;
    this.intercept(e);
  };

  private intercept(e: Event): void {
    const text = this.adapter.readText();
    if (!text.trim()) return;

    const verdict = this.handlers.onSubmitAttempt(text);
    if (verdict === 'send') return; // let the original event proceed untouched

    e.preventDefault();
    e.stopImmediatePropagation();
    // 'hold' means the handler sends later via sendWithoutIntercepting().
    // 'cancel' means nothing more happens -- used by the classification block.
  }
}
