/**
 * Exporting the receipt: copy as text, save as JSON, or save as a PNG card.
 * All of it is generated in this page from counts already on the device --
 * nothing is uploaded, and the file downloads are plain blob links.
 */
import { h } from '../shared/dom';
import type { UsageEvent } from '../shared/types';
import { buildReceipt, receiptText, type Receipt, type ReceiptPeriod } from '../shared/receipt';

const FONT = '"Hanken Grotesk Variable","Hanken Grotesk",ui-sans-serif,system-ui,sans-serif';

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A square card sized for a social post. */
export async function receiptPng(r: Receipt): Promise<Blob> {
  await document.fonts?.ready;
  const W = 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = W;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas unavailable');

  g.fillStyle = '#f3efff';
  g.fillRect(0, 0, W, W);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ddd3fa';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(60, 60, W - 120, W - 120, 36);
  g.fill();
  g.stroke();

  const text = (s: string, x: number, y: number, px: number, weight: number, color: string, align: CanvasTextAlign = 'left'): void => {
    g.font = `${weight} ${px}px ${FONT}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.fillText(s, x, y);
  };

  text('Prompt Firewall', 120, 150, 36, 700, '#5b3fd1');
  text(`${r.period} · ${r.range}`, 120, 198, 26, 500, '#54448f');
  text(String(r.itemsKeptOut), 120, 400, 190, 800, '#1e1247');
  text('items kept out of my prompts', 120, 462, 38, 600, '#1e1247');
  text(`${r.promptsChecked} prompt${r.promptsChecked === 1 ? '' : 's'} checked`, 120, 510, 28, 500, '#54448f');

  const rows = r.byType.slice(0, 5);
  const max = Math.max(1, ...rows.map((t) => t.count));
  rows.forEach((t, i) => {
    const y = 600 + i * 74;
    text(t.type, 120, y, 30, 600, '#1e1247');
    text(String(t.count), W - 120, y, 30, 700, '#5b3fd1', 'right');
    g.fillStyle = '#ddd3fa';
    g.beginPath();
    g.roundRect(120, y + 14, W - 240, 10, 5);
    g.fill();
    g.fillStyle = '#8a70e6';
    g.beginPath();
    g.roundRect(120, y + 14, Math.max(10, ((W - 240) * t.count) / max), 10, 5);
    g.fill();
  });
  if (!rows.length) text('Nothing needed catching yet.', 120, 620, 30, 500, '#54448f');

  text('Counted on my device. What I typed was never stored.', 120, W - 110, 24, 500, '#54448f');

  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode image'))), 'image/png'),
  );
}

export function receiptSection(events: readonly UsageEvent[]): HTMLElement {
  let period: ReceiptPeriod = 7;
  const status = h('span', { class: 'sub', role: 'status' });
  const say = (s: string): void => {
    status.textContent = s;
  };
  const current = (): Receipt => buildReceipt(events, period);

  const pick = h(
    'select',
    { 'aria-label': 'Receipt period', class: 'btn ghost' },
    h('option', { value: '7' }, 'Last 7 days'),
    h('option', { value: '30' }, 'Last 30 days'),
    h('option', { value: 'all' }, 'All time'),
  );
  pick.addEventListener('change', () => {
    period = pick.value === 'all' ? 'all' : (Number(pick.value) as 7 | 30);
  });

  const copy = h('button', { type: 'button', class: 'btn' }, 'Copy as text');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(receiptText(current())).then(
      () => say('Copied. It contains counts only.'),
      () => say('Could not copy. Use the download instead.'),
    );
  });

  const json = h('button', { type: 'button', class: 'btn ghost' }, 'Save JSON');
  json.addEventListener('click', () => {
    save(new Blob([JSON.stringify(current(), null, 2)], { type: 'application/json' }), 'prompt-firewall-receipt.json');
    say('Saved.');
  });

  const png = h('button', { type: 'button', class: 'btn ghost' }, 'Save image');
  png.addEventListener('click', () => {
    receiptPng(current()).then(
      (b) => {
        save(b, 'prompt-firewall-receipt.png');
        say('Saved.');
      },
      () => say('Could not make the image.'),
    );
  });

  return h(
    'section',
    { class: 'block' },
    h('h2', {}, 'Share your receipt'),
    h('p', { class: 'sub' }, 'Counts only. There is no prompt text in anything exported here.'),
    h('div', { class: 'row', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, pick, copy, json, png, status),
  );
}
