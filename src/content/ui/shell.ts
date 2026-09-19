/**
 * Every piece of our UI lives inside a closed-ish shadow root attached to a
 * host element at the end of <body>. Two reasons, both learned the hard way:
 * the site's global CSS cannot reach in and restyle us, and our CSS cannot
 * leak out and break the site during a demo.
 */
const HOST_ID = 'prompt-firewall-root';

const BASE_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
  .layer > * { pointer-events: auto; }

  .card {
    background: #16181d; color: #e8eaed; border: 1px solid #2c3039;
    border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.5);
  }
  .muted { color: #9aa1ad; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  button.pf {
    font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 7px;
    border: 1px solid #343945; background: #23262e; color: #e8eaed; cursor: pointer;
  }
  button.pf:hover { background: #2c3039; }
  button.pf.primary { background: #3b6fd4; border-color: #3b6fd4; color: #fff; }
  button.pf.danger  { background: #8f2d2d; border-color: #a33636; color: #fff; }

  .tok {
    background: #2a2118; color: #f0b429; border: 1px solid #6b4f1d;
    border-radius: 4px; padding: 0 4px; font-family: ui-monospace, monospace; font-size: 12px;
  }
  .del { background: #3a1e1e; color: #ff9c9c; text-decoration: line-through; border-radius: 3px; padding: 0 2px; }
`;

let layer: HTMLDivElement | null = null;

/** Returns the shared overlay layer, creating the shadow host on first call. */
export function getLayer(): HTMLDivElement {
  if (layer?.isConnected) return layer;

  const existing = document.getElementById(HOST_ID);
  existing?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  // CLOSED, not open. With mode:'open' the host page can reach our UI via
  // host.shadowRoot and read everything in it -- including the diff panel,
  // which renders the user's ORIGINAL unredacted text side by side. Closed
  // mode is not a hard security boundary (a page that patches attachShadow
  // before we run could still capture it) but it removes the trivial read.
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = BASE_CSS;
  root.append(style);

  layer = document.createElement('div');
  layer.className = 'layer';
  root.append(layer);
  document.body.append(host);
  return layer;
}

/** Convenience element builder. Keeps the panels readable. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') node.setAttribute('style', v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
