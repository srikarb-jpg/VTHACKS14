/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { getDock, getLayer, setOverlayAnchor, syncYield, overlayYielding } from '../src/content/ui/shell';

const composer = document.createElement('div');
const size = (node: Element, width: number, height: number) => {
  node.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }) as DOMRect;
};

afterEach(() => { document.querySelectorAll('[role=dialog]').forEach((n) => n.remove()); });

it('hides passive panels while a page dialog is open and shows them again when it closes', () => {
  document.body.append(composer);
  setOverlayAnchor(() => composer);
  getDock('left');
  syncYield();
  expect(overlayYielding()).toBe(false);

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  size(dialog, 480, 320);
  document.body.append(dialog);
  syncYield();
  expect(overlayYielding()).toBe(true);
  dialog.remove();
  syncYield();
  expect(overlayYielding()).toBe(false);
});

it('ignores small or closed dialog-like elements, such as a tooltip', () => {
  const tip = document.createElement('div');
  tip.setAttribute('role', 'dialog');
  size(tip, 120, 40);
  document.body.append(tip);
  const closed = document.createElement('div');
  closed.setAttribute('role', 'dialog');
  closed.setAttribute('data-state', 'closed');
  size(closed, 480, 320);
  document.body.append(closed);
  syncYield();
  expect(overlayYielding()).toBe(false);
});

it('steps aside when the page has no composer, e.g. a settings page', () => {
  getLayer();
  setOverlayAnchor(() => null);
  syncYield();
  expect(overlayYielding()).toBe(true);
  setOverlayAnchor(() => composer);
  syncYield();
  expect(overlayYielding()).toBe(false);
});
