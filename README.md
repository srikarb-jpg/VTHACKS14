# Deadbolt

A browser extension that sits between you and an AI chat site and asks two questions
before a prompt leaves the machine: does this need to go out at all, and what is it
carrying?

Everything that decides runs locally. See [`prd.md`](./prd.md) for the full
product argument.

## Run it

```bash
npm install
npm run dev          # vite dev server, HMR into the content script
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** →
select `dist/`. Open <https://claude.ai> and check the console for
`[deadbolt] active on claude.ai`.

```bash
npm test             # detector suite + the labelled eval set
npm run typecheck    # strict, covers src/ test/ dev/
npm run build        # typecheck then production build into dist/
```

The UI harness renders every overlay panel with no extension and no chat site involved —
useful for building UI in parallel. With the dev server running, open
<http://localhost:5173/dev/harness.html>. The toolbar popup and the dashboard have a preview too,
against a fake `chrome` API: <http://localhost:5173/dev/preview.html?page=popup> (also
`&site=other`, `&enabled=0`, `&blocked=1`, `&empty=1`, or `?page=dashboard` / `?page=settings`).
<http://localhost:5173/dev/reveal-lab.html> is a fake thread for the overlays that have to live
with the site's layout: a message duplicated into a screen-reader-only box, a reply that streams
in, and a composer pinned to the bottom. Between them they reproduce every placement bug we have
had — values painted on a hidden copy, values drifting away from their text, and panels sitting
on top of the composer or each other.

## Layout

| Path | Owns | Depends on a browser? |
|---|---|---|
| `src/shared/` | Types, message contracts, feature flags | No |
| `src/worker/` | Detectors and the redaction engine — pure functions | No |
| `src/content/` | Composer adapter, submit gate, overlay UI | Yes |
| `src/background/` | Vault, usage log, settings, badge | Yes |
| `src/popup/` | Toolbar popup: on/off, counts, categories, mode | Yes |
| `src/options/` | Dashboard: Overview and Settings tabs | Yes |
| `dev/harness.html` | Standalone UI workbench | No |
| `test/fixtures/` | The labelled eval set | No |

`src/shared/messages.ts` is the integration seam. Changing a shape in it changes someone
else's code — say so before you do.

## Severity tiers

Severity determines friction and nothing else.

| Tier | Detectors | What happens |
|---|---|---|
| `block` | Classification and control markings | Send is cancelled. Explainer panel. No override. |
| `high` | API keys, private keys, JWTs, SSN, cards (Luhn), IBAN | Auto-redact, send, toast with undo |
| `medium` | Email, phone, street address, DOB | Auto-redact, listed in the toast |
| `low` | NER names and orgs (not yet implemented) | Highlight only, never acts alone |

High and medium are regex plus checksums, which is the only reason they are trusted to
alter text. Anything lower-precision gets a highlight and never touches the prompt.

## Deliberate limitations

Stated here so nobody has to discover them at 3am, and so we can answer honestly when asked.

- **The vault is in-memory and per tab.** An MV3 service worker is killed after ~30s idle,
  which clears the placeholder mapping. Redaction is unaffected; only hover-reveal stops
  working. This is the intended trade — a crash should lose a mapping, not leak one.
- **Rehydration is hover-only.** We do not rewrite the streamed response. Mutating another
  app's React-managed DOM mid-stream is the most likely way to break the page live. Revealing
  a value paints it in our own layer and widens the placeholder span to make room for it —
  the width is the only thing that reaches the page, never the value.
- **The tokenizer is an approximation**, not a real BPE vocabulary, and says so where it is
  shown. It is not on the dashboard at the moment: the final design keeps Overview and
  Settings only. `src/options/tokenizer.ts` is kept so it can come back as its own tab.
- **The router is rules-only.** The embedding classifier is cut. Uncertainty escalates to
  `frontier`, so a wrong guess costs nothing.
- **The scanner runs in-process, not in a Web Worker.** The worker existed to keep NER and
  the embedder off the UI thread; both are cut, and regex over a few KB measures well under
  a millisecond. The module boundary is intact if that changes.
- **The energy range, receipt, category breakdown and any token or energy figures are not on the dashboard** now. The
  calculation and the copy live in git history (`src/options/main.ts` before the redesign).
- **NER is not implemented**, so the `low` tier currently finds nothing.
- **Strict mode behaves as autopilot.** The confirmation step is not wired yet.
- **There is no search lane and no routing chip.** Both were removed; the router only labels each prompt's lane in the usage log.
- **Fonts are bundled, never fetched.** The popup and dashboard use `@fontsource` packages so
  opening them makes no request to a third party. Do not swap in a Google Fonts `<link>`.
- **Design tokens live in `src/shared/theme.css`** (violet and green). The badge colour in
  `src/background/badge.ts` is duplicated there because a service worker cannot read CSS.
- **Floating panels do not place themselves.** They join a dock (`getDock` in
  `src/content/ui/shell.ts`), which stacks them and puts them in the bottom corner of the
  gutter beside the composer, sized to the room available. The gutter is measured between
  the composer's frame and the edges of the content area around it — not the window, or the
  panel is drawn over the site's sidebar. Under ~190px of gutter there is nothing usable
  there and they go above the composer instead. A panel that sets its own `bottom` will
  eventually land on another one.
- **A `ResizeObserver` is not enough to keep the docks in place.** The composer has a
  max-width, so opening the sidebar moves it without resizing it, and nothing fires. There is
  no observer for "an element moved", so `nudgeDocks` follows the layout for ~700ms after a
  click, a keystroke or a CSS transition. It measures per frame and writes only when the
  numbers change, and it stops when nothing is moving (verified: 0 animation frames while
  idle).
- **Panels in a dock size their text in `em`, never `px`.** The dock sets the type size from
  the width it was given (10.8–13px), so a narrow gutter reads as smaller type instead of a
  squeezed, wrapped, truncated version of the wide one. A `px` font size in a docked panel
  opts out of that.
- **The routing chip, block panel and alerts are still the old dark style.** Everything else —
  popup, dashboard, live scan, diff, toast, reveal toggle, pending indicator — is on the
  violet-and-green design.
- **Light and dark come from the `theme` setting, never `prefers-color-scheme`.** The chat
  site has its own switch, and following the OS would put a bright white panel over a dark
  conversation. The toggle is in the popup header and applies to every surface. The dark
  palette exists twice — `src/shared/theme.css` for the popup and dashboard, and again in
  `shell.ts` for the overlays, because a shadow root cannot reach the page's stylesheets.
  Keep the two in step.

## The one thing that must not break

If the redacted text does not reach the editor, the send is **cancelled**, never passed
through. Letting it proceed would transmit the original text while the user believes it
was scrubbed. That is the worst failure this codebase can have, and it has happened once:
a DOM read reported success while ProseMirror's own document still held the original, and
that document is what gets submitted.

Three defences now, in order:

1. `writeText` tries each insertion strategy and checks the DOM after each.
2. `verifyCommitted` waits two animation frames and re-checks, including ProseMirror's
   own state. **Nothing is sent until this passes**, and the toast is shown only after.
3. `auditSentMessage` reads the page back after sending and looks for any value we
   believed we replaced. It compares the page before and after the send
   (`src/worker/audit.ts`), because the same value is often already in the conversation
   from an earlier turn — sent before the extension was on, restored with Undo, or typed
   while protection was paused. Warning about those is how a warning gets ignored.

   **It reports to the console only.** The on-page warning was removed on request, so a
   detected leak now goes to `[deadbolt] AUDIT FAILED` and nowhere else. A leak is
   still detected and still recoverable — but only by someone with DevTools open. Putting
   the panel back is `showLeakWarning` in git history.

Never reorder these so that the toast or the send precedes verification.
