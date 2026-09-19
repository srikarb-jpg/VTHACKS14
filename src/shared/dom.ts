/**
 * A tiny element builder for the extension's own pages.
 *
 * Text goes in as text nodes, never as HTML, so nothing read from storage can
 * ever be interpreted as markup. Only the static SVG constants in icons.ts are
 * parsed as markup.
 */
export type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined | EventListener;

/**
 * `on*` attributes with a function value become listeners. `true` sets an
 * empty attribute. To get a literal "false" (e.g. aria-checked) pass the
 * string 'false': a boolean false omits the attribute.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === 'function') {
      el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child) el.append(child);
  }
  return el;
}

/** Sets a CSS custom property or property without an inline style attribute string. */
export function setStyle<T extends HTMLElement>(el: T, props: Partial<CSSStyleDeclaration>): T {
  Object.assign(el.style, props);
  return el;
}
