/**
 * The post-send leak audit, as a pure function.
 *
 * After a redacted message is sent we read the page back and look for any
 * value we believed we had replaced. The check cannot prevent a leak, only
 * detect one, but a detected leak is recoverable -- delete the message,
 * rotate the credential -- and an undetected one is not.
 *
 * The subtlety is what counts as a leak. The first version searched the whole
 * page for each value and warned if it found one, which is wrong in a way
 * that matters: the same value is often already in the conversation from an
 * earlier turn, sent before the extension was on, or restored with Undo, or
 * typed while protection was paused. None of those were put there by the send
 * being audited, and warning about them teaches people to dismiss the warning
 * -- which is worse than not having it, because the one that matters looks
 * exactly the same.
 *
 * So compare before and after. A value that was already on the page stays at
 * the same count and is not reported; a value this send leaked appears one
 * more time than it did a moment ago.
 */
import type { Placeholder } from '../shared/types';

/** Shorter than this and a "match" is mostly coincidence. */
const MIN_VALUE_LENGTH = 4;

export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

/**
 * Which values this send put on the page that should not be there.
 *
 * `before` is the page's text captured immediately before submitting, `after`
 * the same once the message has landed.
 */
export function leakedValues(
  before: string,
  after: string,
  placeholders: Placeholder[],
): Placeholder[] {
  return placeholders.filter((p) => {
    if (p.value.length < MIN_VALUE_LENGTH) return false;
    return countOccurrences(after, p.value) > countOccurrences(before, p.value);
  });
}
