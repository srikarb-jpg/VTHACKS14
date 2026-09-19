import { describe, expect, it } from 'vitest';
import { summarizeFindings, dropOwnNames } from '../src/content/audit-summary';
import { scan } from '../src/worker/detectors';
import { nerSpansToFindings } from '../src/worker/ner-map';

describe('summarizeFindings', () => {
  it('says so when there is nothing', () => {
    expect(summarizeFindings([])).toBe('Nothing sensitive found in the reply.');
  });

  it('counts by label, most common first', () => {
    const text = 'Mail a@example.com or b@example.org, or call 540-555-0142.';
    expect(summarizeFindings(scan(text).findings).startsWith('2 ')).toBe(true);
  });

  it('groups model findings regardless of their confidence score', () => {
    // Regression: the score is part of the label, so "person (65%)" and
    // "person (71%)" were counted as different things.
    const text = 'Priya and Marcus met Amanda Britfield.';
    const spans = [
      { start: 0, end: 5, label: 'person', score: 0.65, text: 'Priya' },
      { start: 10, end: 16, label: 'person', score: 0.71, text: 'Marcus' },
      { start: 21, end: 37, label: 'person', score: 0.88, text: 'Amanda Britfield' },
    ];
    expect(summarizeFindings(nerSpansToFindings(spans, text))).toBe('3 person');
  });
});

describe('dropOwnNames', () => {
  it('removes the assistant and its maker but keeps the user’s data', () => {
    const text = 'Claude from Anthropic told Priya.';
    const spans = [
      { start: 0, end: 6, label: 'person', score: 0.54, text: 'Claude' },
      { start: 12, end: 21, label: 'organization', score: 0.7, text: 'Anthropic' },
      { start: 28, end: 33, label: 'person', score: 0.8, text: 'Priya' },
    ];
    const kept = dropOwnNames(nerSpansToFindings(spans, text)).map((f) => f.value);
    expect(kept).toEqual(['Priya']);
  });
});
