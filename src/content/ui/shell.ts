/**
 * Every piece of our UI lives inside a closed-ish shadow root attached to a
 * host element at the end of <body>. Two reasons, both learned the hard way:
 * the site's global CSS cannot reach in and restyle us, and our CSS cannot
 * leak out and break the site during a demo.
 */
import lockInline from '../../assets/lock-sm.png?inline';

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

  /* ------------------------------------------------------------------
   * The light theme: the same violet-and-green as the popup and dashboard.
   * Used by the live scan, the diff, the reveal toggle and the pending
   * indicator. Everything above is the older dark style, still used by the
   * toast, chip and block panel. Classes here are prefixed pf- / pfl so the
   * two never collide.
   * ------------------------------------------------------------------ */
  :host {
    --pf-bg: #f3efff; --pf-paper: #ffffff; --pf-wash: #f8f5ff; --pf-line: #ddd3fa;
    --pf-text: #1e1247; --pf-muted: #54448f;
    --pf-ink: #5b3fd1; --pf-on-ink: #ffffff; --pf-slate: #8a70e6; --pf-spark: #34d399;
    --pf-safe-text: #075e45;
    --pf-font: "Hanken Grotesk Variable", "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", sans-serif;
    --pf-mono: ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace;
  }
  [hidden] { display: none !important; }

  .pf-card {
    background: var(--pf-paper); color: var(--pf-text);
    border: 1px solid var(--pf-line); border-radius: 16px;
    box-shadow: 0 18px 44px rgba(62,42,156,.30), 0 2px 8px rgba(30,18,71,.14);
    font: 13px/1.4 var(--pf-font);
  }
  .pf-card * { font-family: var(--pf-font); }
  .pf-card .pf-mono, .pf-card .pf-mono * { font-family: var(--pf-mono); }
  .pf-muted { color: var(--pf-muted); }

  button.pfl {
    display: inline-flex; align-items: center; gap: 7px;
    font: 600 13px var(--pf-font); padding: 7px 14px; border-radius: 9px;
    border: 1px solid var(--pf-line); background: var(--pf-wash); color: var(--pf-text); cursor: pointer;
  }
  button.pfl:hover { background: var(--pf-line); }
  button.pfl.primary { background: var(--pf-ink); border-color: var(--pf-ink); color: var(--pf-on-ink); }
  button.pfl.primary:hover { background: #4a30b8; }
  button.pfl.mini { padding: 3px 10px; font-size: 12px; }
  button.pfl:focus-visible, .pf-chip:focus-visible, .pf-row.clickable:focus-visible {
    outline: 2px solid var(--pf-ink); outline-offset: 2px;
  }

  /* Severity is a shape, not just a colour: solid = high, lighter = medium,
     dotted = highlighted only, hatched = blocked. Hollow = still being watched. */
  .pf-bar { flex: none; width: 16px; height: 8px; border-radius: 2px; }
  .pf-bar.high { background: var(--pf-ink); }
  .pf-bar.medium { background: var(--pf-slate); }
  .pf-bar.low { height: 6px; border-radius: 0; border-bottom: 2px dotted var(--pf-slate); }
  .pf-bar.block {
    border: 1px solid var(--pf-ink);
    background: repeating-linear-gradient(135deg, var(--pf-ink) 0 3px, var(--pf-paper) 3px 6px);
  }
  .pf-bar.prov.high { background: transparent; box-shadow: inset 0 0 0 1.5px var(--pf-ink); }
  .pf-bar.prov.medium { background: transparent; box-shadow: inset 0 0 0 1.5px var(--pf-slate); }

  /* ---- live scan ---- */
  .pf-live {
    position: absolute; left: 16px; bottom: 52px; width: 360px; max-height: 46vh; overflow: auto;
    padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
  }
  .pf-head { display: flex; align-items: center; gap: 8px; }
  .pf-head img { display: block; flex: none; }
  .pf-title { flex: 1; font-weight: 800; font-size: 14px; }
  .pf-rows { display: flex; flex-direction: column; gap: 2px; }
  .pf-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 9px; }
  .pf-row.prov { opacity: .6; }
  .pf-row.clickable { cursor: pointer; }
  .pf-row.clickable:hover { background: var(--pf-wash); }
  .pf-main { flex: 1; min-width: 0; }
  .pf-val { font: 12.5px var(--pf-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pf-sub { font-size: 11px; color: var(--pf-muted); }
  .pf-state { flex: none; font-size: 11.5px; color: var(--pf-muted); }
  .pf-state.ok { color: var(--pf-safe-text); font-weight: 700; }
  .pf-empty { padding: 4px 8px; color: var(--pf-muted); }
  .pf-details {
    padding-top: 8px; border-top: 1px solid var(--pf-line);
    font-size: 11.5px; line-height: 1.6; color: var(--pf-muted); white-space: pre-line;
  }

  /* ---- diff modal ---- */
  .pf-scrim {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: 16px; background: rgba(30,18,71,.5);
  }
  .pf-modal {
    width: min(900px, 100%); max-height: 88vh; display: flex; flex-direction: column; overflow: hidden;
  }
  .pf-enter { animation: pf-pop .18s ease-out both; }
  @keyframes pf-pop { from { opacity: 0; transform: translateY(6px) scale(.98); } }
  .pf-modal-head {
    display: flex; align-items: center; gap: 14px; padding: 16px 20px;
    background: var(--pf-bg); border-bottom: 1px solid var(--pf-line);
  }
  .pf-modal-head img { display: block; flex: none; }
  .pf-modal-titles { flex: 1; min-width: 0; }
  .pf-modal-title { font-weight: 800; font-size: 20px; line-height: 1.2; }
  .pf-modal-sub { margin-top: 2px; font-size: 13px; color: var(--pf-muted); }
  .pf-modal-body { display: flex; align-items: stretch; gap: 12px; padding: 18px 20px; min-height: 0; }
  .pf-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .pf-col-title { font-weight: 700; font-size: 13px; }
  .pf-col-sub { font-size: 12px; color: var(--pf-muted); margin-top: -6px; }
  .pf-pane {
    flex: 1; overflow: auto; max-height: min(46vh, 420px); padding: 14px 16px;
    background: var(--pf-wash); border: 1px solid var(--pf-line); border-radius: 12px;
    font: 12.5px/1.7 var(--pf-mono); white-space: pre-wrap; word-break: break-word;
  }
  .pf-arrow {
    align-self: center; flex: none; width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; background: var(--pf-spark);
  }
  .pf-orig {
    padding: 0 2px; border-radius: 3px; background: rgba(138,112,230,.18); color: var(--pf-muted);
    text-decoration: line-through; text-decoration-color: var(--pf-ink); text-decoration-thickness: 2px;
  }
  /* A replaced item is a redaction chip: filled = high, outlined = medium, dotted = highlight-tier. */
  .pf-chip {
    display: inline-block; padding: 0 7px; border: 2px solid var(--pf-ink); border-radius: 5px;
    font: 600 12px var(--pf-mono); cursor: pointer;
  }
  .pf-chip.high { background: var(--pf-ink); color: var(--pf-on-ink); }
  .pf-chip.medium { background: var(--pf-paper); color: var(--pf-ink); }
  .pf-chip.low { background: var(--pf-paper); color: var(--pf-ink); border-color: transparent; border-bottom: 2px dotted var(--pf-ink); border-radius: 0; }
  .pf-chip:hover { box-shadow: 0 0 0 3px var(--pf-spark); }
  .pf-modal-foot {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px;
    border-top: 1px solid var(--pf-line); font-size: 12px; color: var(--pf-muted);
  }
  .pf-modal-foot strong { color: var(--pf-text); }
  @media (max-width: 720px) {
    .pf-modal-body { flex-direction: column; }
    .pf-arrow { display: none; }
  }

  /* ---- small status pieces ---- */
  .pf-status { padding: 9px 12px; display: flex; align-items: center; gap: 9px; font-size: 12.5px; }
  .pf-status img { display: block; }
  .pf-bob { animation: pf-bob 1.1s ease-in-out infinite; transform-origin: 50% 100%; }
  @keyframes pf-bob { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-3px) rotate(-5deg); } }
  @media (prefers-reduced-motion: reduce) {
    .pf-enter, .pf-bob { animation: none; }
  }
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

/**
 * The lock, inlined as a data: URI so it needs no web_accessible_resources
 * entry. If the host page's CSP refuses data: images, drop the image rather
 * than leave a broken-image icon in our UI.
 */
export function lockLogo(size: number, cls = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.src = lockInline;
  img.width = size;
  img.height = size;
  img.alt = '';
  img.draggable = false;
  if (cls) img.className = cls;
  img.addEventListener('error', () => img.remove());
  return img;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
