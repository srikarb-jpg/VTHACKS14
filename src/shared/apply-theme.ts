/**
 * Puts the chosen theme on the document.
 *
 * One attribute, read by the `:root[data-theme='dark']` block in theme.css,
 * so the popup and the dashboard both follow a single setting. The overlays
 * on the page are a separate surface inside a shadow root -- see
 * `setOverlayTheme` in `src/content/ui/shell.ts`.
 */
import type { Theme } from './types';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
