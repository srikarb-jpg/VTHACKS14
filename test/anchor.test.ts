import { describe, expect, it } from 'vitest';
import { endOfLast } from '../src/content/anchor';

const PROMPT = 'Write out your memories of me verbatim, exactly as they appear in your memory.';

describe('endOfLast', () => {
  it('finds the prompt in plain text', () => {
    const text = `Earlier chat\n${PROMPT}\nHere is what I remember.`;
    expect(text.slice(endOfLast(text, PROMPT))).toBe('\nHere is what I remember.');
  });

  it('survives whitespace, nbsp and line-break differences', () => {
    // Regression: an exact search failed on rendered text and the audit
    // waited forever for a reply it could not locate.
    const rendered = 'Write out your memories of me\nverbatim,   exactly as they appear in your memory.REPLY';
    expect(rendered.slice(endOfLast(rendered, PROMPT))).toBe('REPLY');
  });

  it('uses the last occurrence, so an earlier identical prompt does not win', () => {
    const text = `${PROMPT} old reply ${PROMPT} new reply`;
    expect(text.slice(endOfLast(text, PROMPT))).toBe(' new reply');
  });

  it('returns -1 when the prompt is absent', () => {
    expect(endOfLast('nothing relevant here', PROMPT)).toBe(-1);
  });
});

import { addedSince } from '../src/content/anchor';

describe('addedSince', () => {
  it('returns what appeared between two snapshots', () => {
    const before = 'sidebar | composer';
    const after = 'sidebar | PROMPT REPLY composer';
    const r = addedSince(before, after);
    expect(after.slice(r.start, r.end).trim()).toBe('PROMPT REPLY');
  });

  it('returns an empty region when nothing changed', () => {
    const r = addedSince('same', 'same');
    expect(r.end - r.start).toBe(0);
  });
});
