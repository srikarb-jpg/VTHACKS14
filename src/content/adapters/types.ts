/**
 * The seam that makes a second chat site a day of work instead of a rewrite.
 *
 * Everything site-specific lives behind this interface. The gate, the UI and
 * the scanner know nothing about ProseMirror, React, or claude.ai's DOM.
 */
export interface ComposerAdapter {
  /** Short id used in logs and the usage record. */
  readonly site: string;

  /** The element the user types into, or null if the composer is not mounted. */
  getComposer(): HTMLElement | null;

  /** Current plain text of the composer. */
  readText(): string;

  /**
   * Replace the composer's entire contents. Returns false when every
   * insertion strategy failed, which the caller MUST treat as "do not send" --
   * silently sending unredacted text would be the worst possible failure.
   */
  writeText(text: string): boolean;

  /** Trigger the site's own send. Returns false if the control was not found. */
  submit(): boolean;

  /**
   * Caret offset within the plain text of the composer, or null when the
   * selection is elsewhere. Drives the settled/provisional rule -- a finding
   * the caret sits inside is still being edited.
   */
  getCaretOffset(): number | null;

  /** Where to anchor toasts and panels so they track the composer. */
  getAnchor(): HTMLElement | null;

  /** Assistant message elements, for hover rehydration of placeholders. */
  getResponseNodes(): HTMLElement[];
}
