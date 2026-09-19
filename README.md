# Prompt Firewall

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
`[prompt-firewall] active on claude.ai`.

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
<http://localhost:5173/dev/reveal-lab.html> is a fake thread for the reveal overlay: a message
duplicated into a screen-reader-only box and a reply that streams in, which is the layout that
put revealed values in the wrong place.

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
- **Search lane is not implemented** and its flag ships `false`.
- **Fonts are bundled, never fetched.** The popup and dashboard use `@fontsource` packages so
  opening them makes no request to a third party. Do not swap in a Google Fonts `<link>`.
- **Design tokens live in `src/shared/theme.css`** (violet and green). The badge colour in
  `src/background/badge.ts` is duplicated there because a service worker cannot read CSS.

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
   believed we replaced. It cannot prevent a leak, only detect one — but a detected leak
   is recoverable and a silent one is not.

Never reorder these so that the toast or the send precedes verification.
