/**
 * Every piece of our UI lives inside a closed-ish shadow root attached to a
 * host element at the end of <body>. Two reasons, both learned the hard way:
 * the site's global CSS cannot reach in and restyle us, and our CSS cannot
 * leak out and break the site during a demo.
 */
import lockInline from '../../assets/lock-sm.png?inline';
import type { Theme } from '../../shared/types';

const HOST_ID = 'prompt-firewall-root';

const BASE_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
  .layer > * { pointer-events: auto; }
  /* Passive UI steps aside for the page's own dialogs and pages. */
  .layer.pf-yield .pf-dock, .layer.pf-yield [data-pf-passive] { visibility: hidden; }

  .card {
    background: #16181d; color: #e8eaed; border: 1px solid #2c3039;
    border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.5);
  }
  .muted { color: #9aa1ad; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  button.pf {
    font: inherit; font-size: .98em; padding: 6px 12px; border-radius: 7px;
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
  /*
   * Dark mode, from the "theme" setting -- the same values as the popup's
   * dark palette in src/shared/theme.css. Duplicated rather than imported
   * because a shadow root cannot reach the page's stylesheets, and we would
   * not want the page's either. Keep the two in step.
   */
  :host([data-pf-theme='dark']) {
    --pf-bg: #16132a; --pf-paper: #211c3b; --pf-wash: #2a2350; --pf-line: #3b3268;
    --pf-text: #f0ecff; --pf-muted: #bdb0ee;
    --pf-ink: #9b83ff; --pf-on-ink: #140f2b; --pf-slate: #8f78e0; --pf-spark: #34d399;
    --pf-safe-text: #7fe7bd;
  }
  [hidden] { display: none !important; }

  /*
   * Corner docks. Every floating panel used to place itself, so the toast and
   * the reveal toggle both claimed the bottom right and sat on top of each
   * other. A panel now joins a dock and the dock does the stacking; \`order\`
   * fixes the sequence so it does not depend on which appeared first.
   */
  /*
   * The dock owns the type size for everything in it, and every panel sizes
   * its text in em. A narrow gutter then reads as smaller type rather than as
   * a squeezed, wrapped, truncated version of the wide one.
   */
  .pf-dock {
    position: absolute; bottom: 24px; display: flex; flex-direction: column;
    gap: 10px; max-width: calc(100vw - 32px); pointer-events: none; font-size: 13px;
  }
  .pf-dock > * { pointer-events: auto; }
  .pf-dock.left { left: 16px; align-items: flex-start; }
  .pf-dock.right { right: 16px; align-items: flex-end; }

  .pf-card {
    background: var(--pf-paper); color: var(--pf-text);
    border: 1px solid var(--pf-line); border-radius: 16px;
    box-shadow: 0 18px 44px rgba(62,42,156,.30), 0 2px 8px rgba(30,18,71,.14);
    font: 1em/1.4 var(--pf-font);
  }
  :host([data-pf-theme='dark']) .pf-card {
    box-shadow: 0 18px 44px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4);
  }
  .pf-card * { font-family: var(--pf-font); }
  .pf-card .pf-mono, .pf-card .pf-mono * { font-family: var(--pf-mono); }
  .pf-muted { color: var(--pf-muted); }

  button.pfl {
    display: inline-flex; align-items: center; gap: 7px;
    font: 600 1em var(--pf-font); padding: 7px 14px; border-radius: 9px;
    border: 1px solid var(--pf-line); background: var(--pf-wash); color: var(--pf-text); cursor: pointer;
  }
  button.pfl:hover { background: var(--pf-line); }
  button.pfl.primary { background: var(--pf-ink); border-color: var(--pf-ink); color: var(--pf-on-ink); }
  button.pfl.primary:hover { background: #4a30b8; }
  button.pfl.mini { padding: 3px 10px; font-size: .92em; }
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
    width: 360px; max-width: 100%; max-height: 46vh; overflow: auto;
    padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
  }
  .pf-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  /* The lock scales with the type so the header stays on one line in a
     narrow gutter; 2em is its 26px size at the full type scale. */
  .pf-head img { display: block; flex: none; width: 2em; height: 2em; }
  /* Keeps room for the title, so in a narrow gutter the Details button drops
     to the next line instead of squeezing the title into a column of words. */
  .pf-title { flex: 1 1 7em; min-width: 7em; font-weight: 800; font-size: 1.06em; }
  .pf-rows { display: flex; flex-direction: column; gap: 2px; }
  /* In a narrow gutter the status drops to its own line rather than squeezing
     the value it belongs to down to nothing. */
  .pf-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; padding: 6px 8px; border-radius: 9px; }
  .pf-row.prov { opacity: .6; }
  .pf-row.clickable { cursor: pointer; }
  .pf-row.clickable:hover { background: var(--pf-wash); }
  .pf-main { flex: 1; min-width: 8em; }
  .pf-val { font: .96em var(--pf-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pf-sub { font-size: .85em; color: var(--pf-muted); }
  .pf-state { flex: none; margin-left: auto; font-size: .88em; color: var(--pf-muted); }
  .pf-state.ok { color: var(--pf-safe-text); font-weight: 700; }
  .pf-empty { padding: 4px 8px; color: var(--pf-muted); }
  .pf-details {
    padding-top: 8px; border-top: 1px solid var(--pf-line);
    font-size: .88em; line-height: 1.6; color: var(--pf-muted); white-space: pre-line;
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
  .pf-status { padding: 9px 12px; display: flex; align-items: center; gap: 9px; font-size: .96em; }
  .pf-status img { display: block; }
  .pf-bob { animation: pf-bob 1.1s ease-in-out infinite; transform-origin: 50% 100%; }
  @keyframes pf-bob { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-3px) rotate(-5deg); } }
  @media (prefers-reduced-motion: reduce) {
    .pf-enter, .pf-bob { animation: none; }
  }
`;

let layer: HTMLDivElement | null = null;
let shadowHost: HTMLElement | null = null;
let theme: Theme = 'light';

/**
 * Light or dark for the panels on the page, from the same setting as the
 * popup. Safe to call before any UI exists: the host picks it up when it is
 * created.
 */
export function setOverlayTheme(next: Theme): void {
  theme = next;
  shadowHost?.setAttribute('data-pf-theme', theme);
}

/** Returns the shared overlay layer, creating the shadow host on first call. */
export function getLayer(): HTMLDivElement {
  if (layer?.isConnected) return layer;

  const existing = document.getElementById(HOST_ID);
  existing?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-pf-theme', theme);
  shadowHost = host;
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
  installYield();
  return layer;
}

/**
 * Our docks and underlines are drawn above the whole page, so a dialog the site
 * opens (settings, share, a confirm) would sit underneath them, and on a page
 * with no composer at all they would just float there. Both hide until the
 * page is back to a chat. Our own modals (diff, block panel) are not passive
 * and are unaffected.
 */
let yielding = false;

export function overlayYielding(): boolean { return yielding; }

function pageDialogOpen(): boolean {
  for (const node of document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]')) {
    if (node.getAttribute('data-state') === 'closed' || node.getAttribute('aria-hidden') === 'true') continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const r = node.getBoundingClientRect();
    if (r.width >= 240 && r.height >= 120) return true;
  }
  return false;
}

export function syncYield(): void {
  const next = pageDialogOpen() || resolveAnchor() === null;
  if (next === yielding) return;
  yielding = next;
  layer?.classList.toggle('pf-yield', next);
}

let yieldWatching = false;
function installYield(): void {
  if (yieldWatching) return;
  yieldWatching = true;
  // Sites mount dialogs as children of <body>, so a shallow observer sees them
  // open and close without watching every mutation on the page.
  new MutationObserver(() => syncYield()).observe(document.body, { childList: true });
}

/**
 * The two docks, and where they sit relative to the composer.
 *
 * A chat site puts the composer in the middle of the bottom of the window and
 * leaves a wide empty gutter either side of it. That gutter is where our
 * panels belong: beside the composer, bottom-aligned with it, so they are
 * next to what the user is doing without covering it or pushing up into the
 * conversation. The panels are sized to the gutter they are given.
 *
 * When the window is too narrow for that -- a small laptop, a split screen, a
 * site whose composer runs the full width -- there is no gutter to sit in, and
 * the docks go back above the composer.
 */
export type Side = 'left' | 'right';

/** Clearance from the window edge, and from the composer. */
const EDGE = 16;
const GAP = 16;
/** A panel thinner than this cannot show a finding, so the gutter is not used. */
const MIN_GUTTER = 190;
/** And no wider than the panels want to be, however much room there is. */
const MAX_DOCK = 360;

const docks = new Map<Side, HTMLElement>();
let anchorFn: (() => Element | null) | null = null;
const observed = new Set<Element>();
let ro: ResizeObserver | null = null;

/**
 * Resolving the composer is a querySelector chain, and the follow loop below
 * runs per frame, so hold on to the element until it leaves the document.
 */
let cachedAnchor: Element | null = null;

function resolveAnchor(): Element | null {
  if (cachedAnchor?.isConnected) return cachedAnchor;
  cachedAnchor = anchorFn?.() ?? null;
  return cachedAnchor;
}

/**
 * Follow the layout for a while, a frame at a time.
 *
 * A ResizeObserver is not enough, and this is the second time that has caught
 * us out. The composer has a max-width: opening the sidebar narrows the space
 * around it, but the composer itself keeps its size and simply MOVES. Nothing
 * resizes, so nothing fires, and the panels only caught up on the 1.5s
 * composer poll -- which is what "super slow" looked like.
 *
 * There is no observer for "an element moved", so instead we follow for a
 * beat after anything that could move it: a click, a keystroke, a CSS
 * transition starting or ending. layoutDocks itself is cheap and writes
 * nothing when the numbers have not changed, so the loop costs a rect read
 * per frame and stops as soon as the animation is over.
 */
let follow = 0;
let followUntil = 0;

export function nudgeDocks(ms = 700): void {
  followUntil = Math.max(followUntil, performance.now() + ms);
  if (follow) return;
  const step = (): void => {
    follow = 0;
    layoutDocks();
    syncYield();
    if (performance.now() < followUntil) follow = requestAnimationFrame(step);
  };
  follow = requestAnimationFrame(step);
}

let nudgesInstalled = false;

function installNudges(): void {
  if (nudgesInstalled) return;
  nudgesInstalled = true;
  const opts = { capture: true, passive: true } as const;
  // A sidebar opens because someone clicked or pressed a key, and it slides
  // there on a transition. Between them these cover every move we have seen.
  for (const type of ['click', 'keydown', 'transitionstart', 'transitionend', 'animationend']) {
    document.addEventListener(type, () => nudgeDocks(), opts);
  }
  window.addEventListener('resize', () => nudgeDocks(300), { passive: true });
}

/**
 * Watch exactly these elements for a size change, and nothing else.
 *
 * Both matter. The composer grows as the user types. The content area around
 * it changes width when the sidebar is opened or collapsed -- and that is the
 * one the panels were slow to notice, because without it nothing reported the
 * change until the next scroll or the 1.5s composer poll. A ResizeObserver on
 * the content area fires on every frame of the sidebar's animation instead.
 */
function watch(nodes: (Element | null)[]): void {
  const want = new Set(nodes.filter((n): n is Element => n !== null));
  if (want.size === observed.size && [...want].every((n) => observed.has(n))) return;
  // Nudge rather than lay out once: a size change is usually the first frame
  // of an animation, and the rest of it is movement we would otherwise miss.
  ro ??= new ResizeObserver(() => nudgeDocks(400));
  for (const node of observed) if (!want.has(node)) ro.unobserve(node);
  for (const node of want) if (!observed.has(node)) ro.observe(node);
  observed.clear();
  for (const node of want) observed.add(node);
}

/**
 * Type size for a dock of this width.
 *
 * A narrow gutter shrinks the type rather than the content: squeezing a panel
 * to 190px without this wraps every row onto three lines and truncates the
 * value, which is the part the user is there to read.
 */
function dockFont(width: number): number {
  const t = Math.max(0, Math.min(1, (width - MIN_GUTTER) / (MAX_DOCK - MIN_GUTTER)));
  return Math.round((10.8 + t * 2.2) * 10) / 10;
}

export function getDock(side: Side): HTMLElement {
  const found = docks.get(side);
  if (found?.isConnected) return found;
  const dock = document.createElement('div');
  dock.className = `pf-dock ${side}`;
  docks.set(side, dock);
  getLayer().append(dock);
  installNudges();
  layoutDocks();
  return dock;
}

/** Tells the docks what to sit beside. The composer, in practice. */
export function setOverlayAnchor(fn: () => Element | null): void {
  anchorFn = fn;
  cachedAnchor = null;
  layoutKey = '';
  installNudges();
  layoutDocks();
}

/**
 * The composer's visible frame, starting from the editable node.
 *
 * Which element draws the rounded box around the composer is a site's private
 * business and changes with a redesign. The editable node is inset within it
 * by its padding, and the bar around it usually runs the full width of the
 * page -- measure either one and the gutters come out wrong. So climb from the
 * editable node while each ancestor still hugs it, and stop at the first one
 * that is the page rather than the composer.
 *
 * Hugging means three things, and all of them are needed. A frame is only a
 * little wider than what it wraps -- its own padding. It is not much taller
 * (a page column is). And it does not span the window (a bar does). Each rule
 * is here because dropping it broke a real layout: without the relative width
 * rule the search walked out to claude.ai's bottom bar, which is only the
 * height of the disclaimer line taller than the composer, and reported no
 * gutters at all; without the window-span rule a narrow window did the same.
 */
interface Anchor {
  frame: DOMRect;
  /** The content area's element, watched so a sidebar opening is not news. */
  outer: Element | null;
  left: number;
  right: number;
}

function anchorBox(node: Element): Anchor {
  let box = node.getBoundingClientRect();
  let outer: Element | null = null;
  let parent = node.parentElement;
  for (let depth = 0; parent && depth < 6 && parent !== document.body; depth++) {
    const r = parent.getBoundingClientRect();
    // The ancestor we stop at is the composer's container -- the content area.
    // Its edges, not the window's, are how far our panels may spread: on
    // claude.ai it starts where the sidebar ends, so a panel that respects it
    // cannot be drawn over the sidebar.
    if (r.width > box.width + 80 || r.height > box.height + 48 || r.width > window.innerWidth * 0.92) {
      outer = parent;
      break;
    }
    if (r.width >= box.width) box = r;
    parent = parent.parentElement;
  }
  const bounds = outer?.getBoundingClientRect();
  return {
    frame: box,
    outer,
    left: Math.max(0, bounds?.left ?? 0),
    right: Math.min(window.innerWidth, bounds?.right ?? window.innerWidth),
  };
}

/** The last geometry we laid out for, so a frame that changed nothing writes nothing. */
let layoutKey = '';

export function layoutDocks(): void {
  const anchor = resolveAnchor();
  const found = anchor ? anchorBox(anchor) : null;

  const key = found
    ? `${Math.round(found.frame.left)},${Math.round(found.frame.right)},${Math.round(found.frame.top)},` +
      `${Math.round(found.left)},${Math.round(found.right)},${window.innerWidth},${window.innerHeight},${docks.size}`
    : `none,${window.innerWidth},${window.innerHeight},${docks.size}`;
  if (key === layoutKey) return;
  layoutKey = key;

  watch([anchor, found?.outer ?? null]);

  const rect = found?.frame;
  const known = found !== null && rect !== undefined && rect.height > 0 && rect.top > 80;

  // Above the composer: the fallback, and what we use with no composer at all.
  // Never give up more than half the window to it, or a composer someone has
  // dragged tall would push the panels off the top of the screen.
  const above = known
    ? Math.min(Math.round(window.innerHeight - rect.top + GAP), Math.round(window.innerHeight * 0.5))
    : 24;
  // Beside it: down in the corner, level with the bottom of the window rather
  // than the bottom of the composer. A site puts a disclaimer line under the
  // composer, and sitting level with the composer's box leaves our panels
  // floating above that empty strip instead of filling the corner.
  const beside = EDGE;

  // Measured from the content area's edges, not the window's.
  const gutters: Record<Side, number> = {
    left: known ? rect.left - found.left - EDGE - GAP : 0,
    right: known ? found.right - rect.right - EDGE - GAP : 0,
  };

  for (const [side, dock] of docks) {
    const gutter = Math.floor(gutters[side]);
    if (found && gutter >= MIN_GUTTER) {
      // Pinned to the outside edge of the gutter, not to the composer. Both
      // edges move when the sidebar opens, but pinning here means the panel
      // stays put against that edge and only its width changes -- anchoring
      // it to the composer instead slid the whole panel across the screen.
      const width = Math.min(gutter, MAX_DOCK);
      dock.style.width = `${width}px`;
      dock.style.bottom = `${beside}px`;
      dock.style.fontSize = `${dockFont(width)}px`;
      if (side === 'left') {
        dock.style.right = 'auto';
        dock.style.left = `${Math.round(found.left + EDGE)}px`;
        dock.style.alignItems = 'flex-start';
      } else {
        dock.style.left = 'auto';
        dock.style.right = `${Math.round(window.innerWidth - found.right + EDGE)}px`;
        dock.style.alignItems = 'flex-end';
      }
    } else {
      dock.style.bottom = `${above}px`;
      dock.style.fontSize = `${dockFont(MAX_DOCK)}px`;
      for (const prop of ['width', 'left', 'right', 'align-items']) dock.style.removeProperty(prop);
    }
  }
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
