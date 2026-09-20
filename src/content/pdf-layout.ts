import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';

export interface PdfTextSpan {
  item: TextItem;
  start: number;
  end: number;
}

/** Keep PDF drawing order, explicit line endings and geometric word gaps.
 * A text item can end in the middle of a word: never unconditionally join
 * items with spaces. Offsets refer to the exact string given to detectors.
 */
export function buildPdfText(items: (TextItem | TextMarkedContent)[]): { text: string; spans: PdfTextSpan[] } {
  let text = '';
  let previous: TextItem | undefined;
  const spans: PdfTextSpan[] = [];
  for (const item of items) {
    if (!('str' in item)) continue;
    if (!item.str) {
      if (item.hasEOL && text && !text.endsWith('\n')) text += '\n';
      continue;
    }
    if (previous && text && !text.endsWith('\n')) {
      const height = Math.max(1, Math.abs(previous.height), Math.abs(item.height));
      const dy = Math.abs(item.transform[5] - previous.transform[5]);
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      if (dy > height * 0.5) text += dy > height * 1.8 ? '\n\n' : '\n';
      else if (gap > height * 1.5) text += '\t';
      else if (gap > height * 0.12 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
    }
    const start = text.length;
    text += item.str;
    spans.push({ item, start, end: text.length });
    if (item.hasEOL) text += '\n';
    previous = item;
  }
  return { text, spans };
}
