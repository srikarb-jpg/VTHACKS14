/**
 * @vitest-environment happy-dom
 *
 * Hover rehydration against a thread shaped like a real one: the same message
 * present twice, once in a screen-reader-only box.
 *
 * happy-dom gives every element a zero rect, so this covers what the overlay
 * decides -- what to wrap, what to count, what to forget -- and not where the
 * chips land. Positioning is checked in the browser with dev/reveal-lab.html.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Placeholder } from '../src/shared/types';
import type { ComposerAdapter } from '../src/content/adapters/types';

const PLACEHOLDERS: Placeholder[] = [
  { token: 'SSN_1', kind: 'ssn', value: '423-12-1234' },
  { token: 'EMAIL_1', kind: 'email', value: 'dana@example.org' },
];

const MARKED = '[data-pf-rehydrated]';

async function load() {
  vi.resetModules();
  document.body.innerHTML = '';
  return import('../src/content/rehydrate');
}

/** startRehydration settles on a 400ms timer before it touches the page. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(450);
  await Promise.resolve();
}

let stop: (() => void) | null = null;

async function start(mod: Awaited<ReturnType<typeof load>>): Promise<void> {
  stop = mod.startRehydration({ getComposer: () => null } as unknown as ComposerAdapter, () =>
    Promise.resolve(PLACEHOLDERS),
  );
  await settle();
}

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('hover rehydration', () => {
  it('wraps known placeholders and leaves unknown ones alone', async () => {
    vi.useFakeTimers();
    const mod = await load();
    document.body.innerHTML = '<p>SSN [SSN_1], card [CARD_9], mail [EMAIL_1]</p>';
    await start(mod);

    const spans = [...document.querySelectorAll(MARKED)].map((s) => s.textContent);
    expect(spans).toEqual(['[SSN_1]', '[EMAIL_1]']);
    expect(document.body.textContent).toContain('[CARD_9]');
  });

  it('never writes the real value into the page', async () => {
    vi.useFakeTimers();
    const mod = await load();
    document.body.innerHTML = '<p>SSN [SSN_1]</p>';
    await start(mod);
    mod.setRevealAll(true);

    expect(document.body.innerHTML).not.toContain('423-12-1234');
    const span = document.querySelector(MARKED) as HTMLElement;
    expect(span.getAttribute('title')).not.toContain('423');
  });

  it('counts redacted items, not the copies of a message on the page', async () => {
    vi.useFakeTimers();
    const mod = await load();
    // The visible message, plus the screen-reader copy of the same text.
    document.body.innerHTML =
      '<div class="sr">My SSN is [SSN_1] and mail [EMAIL_1]</div>' +
      '<div class="msg">My SSN is [SSN_1] and mail [EMAIL_1]</div>';
    const counts: number[] = [];
    mod.setWrappedCountHandler((n) => counts.push(n));
    await start(mod);

    expect(document.querySelectorAll(MARKED)).toHaveLength(4);
    expect(mod.revealedCount()).toBe(2);
    expect(counts.at(-1)).toBe(2);
  });

  it('forgets spans the page has thrown away', async () => {
    vi.useFakeTimers();
    const mod = await load();
    document.body.innerHTML = '<p id="a">[SSN_1]</p>';
    await start(mod);
    expect(mod.revealedCount()).toBe(1);

    // A re-render replaces the node we wrapped.
    document.getElementById('a')?.remove();
    mod.repaintReveals();
    expect(mod.revealedCount()).toBe(0);
  });

  it('finds tokens inside a field value and counts them with the rest', async () => {
    vi.useFakeTimers();
    const mod = await load();
    document.body.innerHTML =
      '<input id="subject" value="Re: [EMAIL_1]">' +
      '<textarea id="body">SSN [SSN_1], again [EMAIL_1]</textarea>' +
      '<p>plain [EMAIL_1]</p>';
    await start(mod);

    // Two distinct tokens across three places -- the field is not counted twice.
    expect(mod.revealedCount()).toBe(2);
    // The field's own value is never rewritten.
    expect((document.getElementById('body') as HTMLTextAreaElement).value).toBe(
      'SSN [SSN_1], again [EMAIL_1]',
    );
  });

  it('never puts a real value into the page when a field is revealed', async () => {
    vi.useFakeTimers();
    const mod = await load();
    document.body.innerHTML = '<textarea id="body">SSN [SSN_1]</textarea>';
    const field = document.getElementById('body') as HTMLTextAreaElement;
    // happy-dom lays nothing out; give the field a box so it counts as on screen.
    field.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 60, width: 200, height: 60 }) as DOMRect;
    // happy-dom reports an empty overflow for these, which reads as "clips".
    for (const el of [document.body, document.documentElement]) {
      el.style.overflowX = 'visible';
      el.style.overflowY = 'visible';
    }
    await start(mod);
    mod.setRevealAll(true);

    expect(field.value).toBe('SSN [SSN_1]');
    expect(document.body.innerHTML).not.toContain('423-12-1234');
    // Only a colour goes in, and it comes back out.
    expect(field.style.color).toBe('transparent');
    mod.setRevealAll(false);
    expect(field.style.color).toBe('');
  });

  it('does not paint over text the page has drawn something on top of', async () => {
    vi.useFakeTimers();
    const { coveredByPage } = await import('../src/content/occlusion');
    document.body.innerHTML = '<p id="msg">hi</p><div id="composer">write</div>';
    const msg = document.getElementById('msg') as HTMLElement;
    const composer = document.getElementById('composer') as HTMLElement;
    const box = { left: 10, top: 10, width: 40, height: 16 };

    document.elementFromPoint = () => composer;
    expect(coveredByPage(msg, box)).toBe(true);
    document.elementFromPoint = () => msg;
    expect(coveredByPage(msg, box)).toBe(false);
    // An ancestor answering means the text itself is what is on top.
    document.elementFromPoint = () => document.body;
    expect(coveredByPage(msg, box)).toBe(false);
  });

  it('notices a menu over the edge of a big field even when its middle is clear', async () => {
    vi.useFakeTimers();
    const { partlyCovered } = await import('../src/content/occlusion');
    document.body.innerHTML = '<textarea id="f"></textarea><div id="menu">menu</div>';
    const field = document.getElementById('f') as HTMLElement;
    const menu = document.getElementById('menu') as HTMLElement;
    const box = { left: 100, top: 100, width: 600, height: 300 };

    // The menu sits over the left 200px only.
    document.elementFromPoint = (x: number) => (x < 300 ? menu : field);
    expect(partlyCovered(field, box)).toBe(true);
    document.elementFromPoint = () => field;
    expect(partlyCovered(field, box)).toBe(false);
  });
});
