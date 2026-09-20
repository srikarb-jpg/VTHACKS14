/**
 * The post-send audit. Its job is to be believed, which means it must not cry
 * wolf over values that were already on the page before this send.
 */
import { describe, expect, it } from 'vitest';
import { countOccurrences, leakedValues } from '../src/worker/audit';
import type { Placeholder } from '../src/shared/types';

const ssn: Placeholder = { token: 'SSN_1', kind: 'ssn', value: '123-12-1233' };
const key: Placeholder = { token: 'API_KEY_1', kind: 'api_key', value: 'sk-ant-abc123xyz' };

describe('countOccurrences', () => {
  it('counts every non-overlapping match', () => {
    expect(countOccurrences('a b a b a', 'a')).toBe(3);
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('nothing here', 'x')).toBe(0);
    expect(countOccurrences('', 'x')).toBe(0);
    expect(countOccurrences('x', '')).toBe(0);
  });
});

describe('leakedValues', () => {
  it('reports a value this send put on the page', () => {
    const before = 'You: My SSN is [SSN_1]';
    const after = 'You: My SSN is [SSN_1]\nYou: My SSN is 123-12-1233';
    expect(leakedValues(before, after, [ssn])).toEqual([ssn]);
  });

  it('stays quiet when the redaction held', () => {
    const before = 'Claude: what can I help with?';
    const after = 'Claude: what can I help with?\nYou: My SSN is [SSN_1]';
    expect(leakedValues(before, after, [ssn])).toEqual([]);
  });

  it('does not blame this send for a value already in the conversation', () => {
    // Sent earlier with protection off, or restored with Undo. Still on the
    // page, but not something this send did -- and warning about it every
    // time afterwards is how a warning gets ignored.
    const before = 'You: My SSN is 123-12-1233\nClaude: I cannot use that.';
    const after = `${before}\nYou: My SSN is [SSN_1]`;
    expect(leakedValues(before, after, [ssn])).toEqual([]);
  });

  it('still catches a second leak of a value that was already there', () => {
    const before = 'You: My SSN is 123-12-1233';
    const after = 'You: My SSN is 123-12-1233\nYou: again, 123-12-1233';
    expect(leakedValues(before, after, [ssn])).toEqual([ssn]);
  });

  it('reports each leaked value and only those', () => {
    const before = '';
    const after = 'key sk-ant-abc123xyz and ssn [SSN_1]';
    expect(leakedValues(before, after, [ssn, key])).toEqual([key]);
  });

  it('ignores values too short to match by anything but coincidence', () => {
    const tiny: Placeholder = { token: 'X_1', kind: 'ssn', value: '42' };
    expect(leakedValues('', '42 is the answer', [tiny])).toEqual([]);
  });
});
