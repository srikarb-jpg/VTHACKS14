import { scan, resolveOverlaps } from '../worker/detectors';
import { redact } from '../worker/redact';
import type { Finding, Placeholder } from '../shared/types';
import { detectAttachmentEntities, withoutHeadings } from '../worker/attachment-entities';
import { UploadBlocked } from './upload-blocked';

export interface ScrubResult {
  file: File;
  placeholders: Placeholder[];
  /** Things the user should know: limits hit, or parts that were not scanned. */
  notices?: string[];
  /** The original file was handed on because it could not be processed. */
  unscanned?: boolean;
}

export const MAX_FILE_BYTES = 100_000;
export const MAX_PDF_BYTES = 10_000_000;
const TEXT_EXTENSION = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|log|js|jsx|ts|tsx|py|java|c|cpp|h|css|html|sql|sh|toml|ini)$/i;
const PDF_EXTENSION = /\.pdf$/i;

export async function scrubAttachment(
  file: File,
  detectNames: (text: string) => Promise<Finding[]> = async () => [],
): Promise<ScrubResult> {
  const notices: string[] = [];
  // A failed name scan weakens detection; it must not stop the upload.
  const names = async (text: string): Promise<Finding[]> => {
    try { return await detectNames(text); }
    catch { notices.push('The name and organization scan was unavailable, so only pattern-based redaction was applied.'); return []; }
  };
  const isPdf = PDF_EXTENSION.test(file.name);
  if (!isPdf && !TEXT_EXTENSION.test(file.name)) throw new Error('Only text files and text-based PDFs are supported. Office, images, and archives are not uploaded.');
  const limit = isPdf ? MAX_PDF_BYTES : MAX_FILE_BYTES;
  if (file.size > limit) throw new Error(isPdf ? 'PDFs must be 10 MB or smaller.' : 'Text files must be 100 KB or smaller.');
  const bytes = await file.arrayBuffer();
  if (isPdf) {
    const { scrubPdf } = await import('./pdf-attachment');
    try {
      const out = await scrubPdf(bytes, async (text) => {
        const findings = scan(text).findings;
        if (findings.some((f) => f.severity === 'block')) throw new UploadBlocked('Classification markings detected. Upload blocked.');
        const merged = resolveOverlaps([...findings, ...withoutHeadings([...detectAttachmentEntities(text), ...await names(text)])]);
        const result = redact(text, merged);
        return { placeholders: result.placeholders, findings: merged.filter((f) => f.severity === 'high' || f.severity === 'medium' || f.severity === 'block') };
      });
      return { ...out, notices: [...notices, ...out.notices] };
    } catch (error) {
      if (error instanceof UploadBlocked) throw error;
      // Could not scan it. Attach it unchanged and say so, rather than stop the user.
      return { file, placeholders: [], unscanned: true, notices: [`"${file.name}" was attached without scanning. ${error instanceof Error ? error.message : ''}`.trim()] };
    }
  }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Use a UTF-8 text file. This file was not uploaded.'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('Binary file contents are not supported.');
  const findings = scan(text).findings;
  if (findings.some((f) => f.severity === 'block')) throw new UploadBlocked('Classification markings detected. Upload blocked.');
  const result = redact(text, resolveOverlaps([...findings, ...withoutHeadings([...detectAttachmentEntities(text), ...await names(text)])]));
  // File mappings must not collide with another attachment or composer tokens.
  const namespace = crypto.randomUUID().replaceAll('-', '').toUpperCase();
  const placeholders = result.placeholders.map((p) => ({ ...p, token: `FILE_${namespace}_${p.token}` }));
  let output = result.redacted;
  result.placeholders.forEach((p, i) => { output = output.replaceAll(`[${p.token}]`, `[${placeholders[i]!.token}]`); });
  // Do not transmit a potentially sensitive original filename or timestamp.
  return { file: new File([output], `scanned-${namespace.slice(0, 8)}.txt`, { type: 'text/plain', lastModified: 0 }), placeholders, notices };
}

interface AttachmentOptions {
  enabled(): boolean;
  scrub(file: File): Promise<ScrubResult>;
  remember(placeholders: Placeholder[]): void;
  status(message: string): void;
}

/** Hold both native picker events; replay only after the whole batch passes. */
export function attachFileScanner(options: AttachmentOptions): () => void {
  const replaying = new WeakSet<HTMLInputElement>();
  const jobs = new WeakMap<HTMLInputElement, object>();
  let active = true;
  const intercept = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || replaying.has(input) || !options.enabled()) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (!input.files?.length) return;
    const files = Array.from(input.files);
    input.value = ''; // Remove originals before yielding to asynchronous work.
    const job = {};
    jobs.set(input, job);
    options.status('Scanning attachments locally…');
    void (async () => {
      try {
        if (files.length > 5) throw new Error('Select up to five files at a time.');
        const results = [];
        for (const file of files) results.push(await options.scrub(file));
        if (!active || jobs.get(input) !== job) return;
        const transfer = new DataTransfer();
        results.forEach((r) => transfer.items.add(r.file));
        input.files = transfer.files;
        const placeholders = results.flatMap((r) => r.placeholders);
        options.remember(placeholders);
        replaying.add(input);
        try {
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } finally { replaying.delete(input); }
        const rebuilt = results.some((r) => r.file.type === 'application/pdf' && !r.unscanned);
        const pdfNote = rebuilt ? ' PDFs keep their page appearance with redaction blocks; text is no longer selectable.' : '';
        const notes = results.flatMap((r) => r.notices ?? []);
        options.status(`${results.length} file(s) attached; ${placeholders.length} value(s) redacted. Check the attachment before sending.${pdfNote}${notes.length ? ` Note: ${notes.join(' ')}` : ''}`);
      } catch (error) {
        if (active && jobs.get(input) === job) options.status(error instanceof Error ? error.message : 'Attachment scan failed. Nothing was uploaded.');
      }
    })();
  };
  const preventFileBypass = (event: Event): void => {
    if (!options.enabled()) return;
    const data = event instanceof DragEvent ? event.dataTransfer : event instanceof ClipboardEvent ? event.clipboardData : null;
    if (!data || (!data.files.length && !Array.from(data.types).includes('Files'))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    options.status('Use the site’s upload button to scan files before attaching them.');
  };
  window.addEventListener('input', intercept, true);
  window.addEventListener('change', intercept, true);
  window.addEventListener('drop', preventFileBypass, true);
  window.addEventListener('paste', preventFileBypass, true);
  return () => {
    active = false;
    window.removeEventListener('input', intercept, true);
    window.removeEventListener('change', intercept, true);
    window.removeEventListener('drop', preventFileBypass, true);
    window.removeEventListener('paste', preventFileBypass, true);
  };
}
