import type { Finding } from '../shared/types';
import type { NerSpan } from '../shared/ner';
import { nerSpansToFindings, MIN_SCORE } from '../worker/ner-map';

export const ATTACHMENT_ENTITIES = ['person', 'organization', 'location', 'school', 'university', 'city', 'state', 'postal code'];

/** Use overlapping windows to keep document context around line boundaries.
 * Attachment findings have no clickable confirmation UI, so detected personal
 * entities use the attachment redaction policy instead of composer highlights.
 */
export async function detectAttachmentNames(
  text: string,
  detect: (texts: string[]) => Promise<{ spans: NerSpan[][]; error: string | null }>,
): Promise<Finding[]> {
  if (!text.trim()) return [];
  const chunks: { text: string; start: number }[] = [];
  for (let start = 0; start < text.length; start += 600) {
    chunks.push({ text: text.slice(start, start + 800), start });
    if (start + 800 >= text.length) break;
  }
  const result = await detect(chunks.map((c) => c.text));
  if (result.error || result.spans.length !== chunks.length) throw new Error('Name and institution scan unavailable.');
  const findings = chunks.flatMap((chunk, i) => nerSpansToFindings(result.spans[i]!, chunk.text)
    .filter((f) => ['person', 'organization', 'location'].includes(f.kind) && (f.score ?? 0) >= MIN_SCORE)
    .map((f) => ({ ...f, start: f.start + chunk.start, end: f.end + chunk.start, severity: 'medium' as const })));
  return findings;
}
