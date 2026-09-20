/** @vitest-environment happy-dom */
import { it, expect, vi } from 'vitest';
import { attachFileScanner } from '../src/content/attachments';

it('hides original picker events and releases only sanitized files', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  document.body.append(input);
  const original = new File(['alice@example.com'], 'private.txt');
  const clean = new File(['[EMAIL_1]'], 'scanned.txt');
  const dt = new DataTransfer();
  dt.items.add(original);
  input.files = dt.files;
  let finish!: (value: { file: File; placeholders: [] }) => void;
  const scrub = vi.fn(() => new Promise<{ file: File; placeholders: [] }>((resolve) => { finish = resolve; }));
  const detach = attachFileScanner({ enabled: () => true, scrub, remember: vi.fn(), status: vi.fn() });
  const seen: File[] = [];
  input.addEventListener('change', () => seen.push(...Array.from(input.files ?? [])));
  try {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(seen).toEqual([]);
    expect(scrub).toHaveBeenCalledTimes(1);
    finish({ file: clean, placeholders: [] });
    await vi.waitFor(() => expect(seen).toEqual([clean]));
  } finally { detach(); input.remove(); }
});

it('never replays a failed batch', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  document.body.append(input);
  const dt = new DataTransfer();
  dt.items.add(new File(['binary'], 'report.pdf'));
  input.files = dt.files;
  const status = vi.fn();
  const detach = attachFileScanner({ enabled: () => true, scrub: async () => { throw new Error('Unsupported'); }, remember: vi.fn(), status });
  const received = vi.fn();
  input.addEventListener('change', received);
  try {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith('Unsupported'));
    expect(received).not.toHaveBeenCalled();
    expect(input.files?.length).toBe(0);
  } finally { detach(); input.remove(); }
});
