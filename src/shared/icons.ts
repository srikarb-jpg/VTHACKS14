/**
 * The lock character, plus a few small stroke icons.
 *
 * The character is the product's face: it is the logo, the toolbar icon and
 * the popup's hero. The two PNGs are the same drawing at two sizes, so small
 * uses stay crisp instead of downscaling a large file.
 *
 * Every SVG string here is a constant written in this file. Nothing
 * user-derived is ever interpolated into it, which is what makes parsing it as
 * markup safe.
 */
import lockLarge from '../assets/lock.png';
import lockSmall from '../assets/lock-sm.png';

/** Parses one static SVG string into an element. */
export function icon(markup: string): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGElement;
}

/**
 * The lock as an image. `size` is the CSS width and height. Decorative by
 * default (empty alt): put the meaning on the control that contains it.
 */
export function lock(size: number, opts: { large?: boolean; className?: string; alt?: string } = {}): HTMLImageElement {
  const img = document.createElement('img');
  img.src = opts.large || size > 48 ? lockLarge : lockSmall;
  img.width = size;
  img.height = size;
  img.alt = opts.alt ?? '';
  img.draggable = false;
  if (opts.className) img.className = opts.className;
  return img;
}

/** A hand-drawn arrow for the handwritten note. */
export function arrow(): SVGElement {
  return icon(
    `<svg width="64" height="44" viewBox="0 0 64 44" fill="none" aria-hidden="true" focusable="false" ` +
      `style="stroke:var(--pf-muted)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M58 38 C 42 42, 20 34, 9 12"/><path d="M6 21 L9 12 L18 15"/></svg>`,
  );
}

const stroke = (d: string): SVGElement =>
  icon(
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
      `stroke-linecap="round" aria-hidden="true" focusable="false">${d}</svg>`,
  );

export const icons = {
  dashboard: () =>
    stroke(
      '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/>' +
        '<rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
    ),
  pause: () => stroke('<path d="M9 5v14M15 5v14"/>'),
  play: () => stroke('<path d="M8 5v14l11-7z" stroke-linejoin="round"/>'),
  settings: () =>
    stroke('<path d="M4 8h9M19 8h1M4 16h1M11 16h9"/><circle cx="16" cy="8" r="2.2"/><circle cx="8" cy="16" r="2.2"/>'),
};
