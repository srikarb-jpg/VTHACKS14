import { el, getLayer } from './shell';

let panel: HTMLElement | null = null;
export function showAttachmentStatus(message: string): void {
  panel?.remove();
  const close = el('button', { class: 'pfl', type: 'button', 'aria-label': 'Dismiss attachment status' }, 'Dismiss');
  panel = el('div', { class: 'pf-card', role: 'status', style: 'position:absolute;right:16px;bottom:64px;max-width:360px;padding:14px;display:grid;gap:10px' },
    el('strong', {}, 'Attachment privacy scan'), el('span', {}, message), close);
  close.onclick = () => panel?.remove();
  getLayer().append(panel);
}
