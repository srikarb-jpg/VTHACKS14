# Attachment scanning

Reload the unpacked extension from `dist` and refresh Claude. With protection
enabled in Autopilot or Strict mode, select files using Claude's upload button.
The extension holds the file-input events, scans locally, and hands the site
new sanitized files. Original files on disk are unchanged. Watch mode and
disabled protection leave uploads unchanged.

Supported: UTF-8 TXT, Markdown, CSV/TSV, JSON/JSONL, XML, YAML, logs, text-based
PDFs, and the source-code extensions listed in `src/content/attachments.ts`.
Limits: five files per selection; 100,000 bytes per text file; 10 MB per input
PDF; 20 PDF pages; 100,000 extracted PDF characters; 12 million rendered pixels
per page; and 20 MB per output PDF.
Office files, images, archives, binary content, and invalid UTF-8 are not
accepted. Classification markings in any file stop the upload; that is policy.

Nothing else about scanning a PDF stops the user. A PDF that cannot be
processed (encrypted, malformed, no selectable text, over the page, text or
size limits, or slower than the 60-second timer) is attached unchanged, and the
status panel says it was not scanned. A failed or timed-out name scan continues
with pattern-based redaction and says so. PDFs with images keep the images as
pixels: their text is scanned, their contents are not read (there is no OCR).

Text files become `.txt`. PDFs now remain `.pdf`: PDF.js renders each page
locally at 2x scale, detected text regions are replaced with opaque pixels,
and pdf-lib builds a new document from those redacted page images. Page sizes,
positions, headings, and visual spacing are retained. Embedded fonts are
rendered; missing fonts may be substituted. Original PDF objects, metadata,
attachments, forms, annotations, and text layers are not copied.

The PDF output is rasterized: text is no longer selectable, links/forms are
not interactive, and the receiving AI must read the page images. It does not
guarantee higher AI or detector accuracy. Permanent PDF blocks cannot be
revealed through the text-placeholder restoration UI. Redaction uses the PDF's
glyph advances and kerning to cover the detected substring within a text run,
preserving surrounding activity names, roles, and dates. Ligatures are covered
as complete glyphs. If character positions cannot be verified unambiguously,
the whole text item is covered: wider than needed, never narrower. Rotated,
skewed or vertical sensitive text is covered as a whole item too, and the whole
page if even that geometry is unusable. Page rotation is supported.

Regex detectors run over the whole file. Attachment-specific rules also redact
resume header names (when education, resume sections, and contact context are
present), complete US city/state/ZIP lines, and education institutions. A
school identified in the education section is redacted at repeated mentions,
including extracurricular sections. These rules work without local AI and
are contextual heuristics, not exhaustive name recognition.

If local NER is enabled, it runs with overlapping context windows and explicit
person, organization, school, university, city, state and postal-code labels.
Attachment entity findings at 0.45 or above are redacted: the composer's
click-to-confirm and automatic-name settings do not gate attachment findings,
because there is no interactive name-highlighting UI inside an attachment.
A failed or timed-out name scan is reported and skipped. Detection remains
incomplete. Extraction respects PDF line endings and word positions instead
of inserting spaces between every fragment. Filenames are replaced. Text-file
placeholder mappings stay in memory for response restoration. Redactions
increment the badge. Unrecognized or outlined text can still evade detection.

File drops and file pastes are blocked while protection is active, with a
message directing the user to the upload button. Text pasting is unchanged.
Files attached before the extension loads are not scanned retroactively.

## Live verification still required

Automated tests cover redaction, rejection, unique mappings, event replay,
PDF line reconstruction, glyph widths/kerning, substring pixel replacement,
page rotation, unchanged safe
pixels, and absence of original metadata/text layers in rebuilt PDFs.
They do not establish compatibility with Claude's live upload implementation.
Use synthetic data to check:

1. Attach a TXT containing a fake email; confirm the site shows a scanned TXT
   attachment and receives placeholders instead of the email.
2. Attach multiple supported files and check that each appears only once.
3. Select a text-based PDF and confirm the generated PDF retains its page
   layout with permanent redaction blocks. PDFs that cannot be processed should
   attach unchanged with a "without scanning" note.
4. Try file drop/paste, name-model failure, and classification markings.
5. Confirm normal composer submission and response restoration still work.

This is DOM interception, not network interception. Earlier site capture
handlers or a future upload mechanism can bypass this hook; recheck it when
the site changes.

For a synthetic before/after visual sample, run the PDF visual test with
`PF_PDF_PREVIEW=1`. It writes PDFs and PNGs to `dev/pdf-preview/`.
Rendering uses the [PDF.js page and text APIs](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
