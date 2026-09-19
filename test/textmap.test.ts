/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { buildTextMap, offsetToRange } from '../src/content/textmap';
import { scan } from '../src/worker/detectors';

function make(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('buildTextMap', () => {
  it('concatenates text nodes across inline elements', () => {
    const el = make('Hello <b>there</b> friend');
    expect(buildTextMap(el).text).toBe('Hello there friend');
  });

  it('inserts newlines at block boundaries like a paragraph split', () => {
    const el = make('<p>One</p><p>Two</p>');
    expect(buildTextMap(el).text).toBe('One\nTwo\n');
  });

  it('treats <br> as a newline', () => {
    const el = make('a<br>b');
    expect(buildTextMap(el).text).toBe('a\nb');
  });

  it('normalises non-breaking spaces without changing length', () => {
    const el = make('a b');
    const map = buildTextMap(el);
    expect(map.text).toBe('a b');
    expect(map.text.length).toBe(3);
  });

  it('segment offsets index back into the mapped text exactly', () => {
    const el = make('<p>Mail <b>dana@example.com</b> now</p>');
    const map = buildTextMap(el);
    for (const seg of map.segments) {
      expect(map.text.slice(seg.start, seg.start + seg.length)).toBe(seg.node.nodeValue);
    }
  });
});

describe('offsetToRange', () => {
  it('a finding round-trips to a Range covering exactly its text', () => {
    const el = make('<p>Mail dana@example.com now</p>');
    document.body.append(el);
    const map = buildTextMap(el);
    const f = scan(map.text).findings.find((x) => x.kind === 'email');
    expect(f).toBeDefined();

    const range = offsetToRange(map, f!.start, f!.end);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('dana@example.com');
    el.remove();
  });

  it('spans element boundaries', () => {
    // The address is split across two inline elements, as a rich editor
    // will do after any styling or spellcheck markup.
    const el = make('<p>Mail <span>dana@exa</span><span>mple.com</span> now</p>');
    document.body.append(el);
    const map = buildTextMap(el);
    const f = scan(map.text).findings.find((x) => x.kind === 'email');
    expect(f).toBeDefined();

    const range = offsetToRange(map, f!.start, f!.end);
    expect(range!.toString()).toBe('dana@example.com');
    el.remove();
  });

  it('returns null rather than throwing on out-of-range offsets', () => {
    const el = make('<p>short</p>');
    const map = buildTextMap(el);
    expect(offsetToRange(map, 900, 950)).toBeNull();
  });
});
