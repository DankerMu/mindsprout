import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import type { MindMap, MindNode, Position } from '../src/contexts/map/domain/types';
import { envelopeOf, readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });
const D: MindNode = { id: 'd', text: 'D', children: [] };
const C: MindNode = { id: 'c', text: 'C', children: [D] };
const S: MindNode = { id: 's', text: 'Sibling', children: [] };
const Q: MindNode = { id: 'q', text: 'Existing child', children: [] };
const P: MindNode = { id: 'p', text: 'P', children: [Q] };
const F: MindNode = {
  id: 'f',
  text: 'Floating',
  position: { x: 700.25, y: 200.75 },
  children: [{ id: 'fc', text: 'Floating child', children: [] }],
};
const G: MindNode = { id: 'g', text: 'Other floating', position: { x: 700, y: 400 }, children: [] };
// Empty text gives a font-independent 24px root width for exact (400,300) mouse input;
// the fractional floating root separately proves that drag positions are not rounded.
const ROOT: MindNode = { id: 'r', text: '', children: [S, C, P] };
const MAP: MindMap = {
  id: 'single-node-drag',
  title: '单节点拖动',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [ROOT, F, G],
};
const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const undo = (page: Page) => page.getByRole('button', { name: '撤销', exact: true });

async function position(page: Page, id: string): Promise<Position> {
  return nodeAt(page, id).evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f };
  });
}
async function screenPoint(page: Page, point: Position): Promise<Position> {
  return page.locator('.react-flow__viewport').evaluate((element, flow) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    const canvas = element.closest('.react-flow');
    if (canvas === null) throw new Error('missing canvas');
    const box = canvas.getBoundingClientRect();
    return { x: box.x + matrix.e + flow.x * matrix.a, y: box.y + matrix.f + flow.y * matrix.d };
  }, point);
}
async function begin(page: Page, id: string) {
  const origin = await position(page, id);
  const grab = await screenPoint(page, { x: origin.x + 20, y: origin.y + 10 });
  // Native mouse coordinates are integral; preserve the actual, not nominal, grab offset.
  await page.mouse.move(Math.trunc(grab.x), Math.trunc(grab.y));
  await page.mouse.down();
  return origin;
}
async function movePointer(page: Page, point: Position) {
  const screen = await screenPoint(page, point);
  await page.mouse.move(Math.trunc(screen.x), Math.trunc(screen.y), { steps: 12 });
}
async function dropOn(page: Page, id: string, target: string) {
  const destination = await position(page, target);
  await begin(page, id);
  await movePointer(page, { x: destination.x + 20, y: destination.y + 10 });
  await page.mouse.up();
}
async function storedRoots(page: Page) {
  const record = (await readRecord(page, MAP.id)) as { map: MindMap };
  return record.map.roots;
}
async function assertUndo(page: Page, roots: MindNode[]) {
  await expect.poll(() => storedRoots(page)).toEqual(roots);
  await expect(undo(page)).toBeEnabled();
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  await expect.poll(() => storedRoots(page)).toEqual(MAP.roots);
}

test.describe('single-node drag', () => {
  let noise: string[];
  test.beforeEach(async ({ page }) => {
    noise = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') noise.push(message.text());
    });
    page.on('pageerror', (error) => {
      noise.push(String(error));
    });
    await seedRecords(page, [envelopeOf(MAP)]);
    await page.goto(`/maps/${MAP.id}`);
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expect(nodeAt(page, 'g')).toBeVisible();
    const canvas = await page.getByRole('region', { name: '思维导图画布' }).boundingBox();
    if (canvas === null) throw new Error('missing canvas bounds');
    await page.mouse.move(canvas.x + 500, canvas.y + 300);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() =>
        page
          .locator('.react-flow__viewport')
          .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a),
      )
      .toBe(0.5);
    await expect(undo(page)).toBeDisabled();
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({
      path: `${EVIDENCE}/drag-${info.title.replaceAll(/[^a-zA-Z0-9]+/g, '-')}.png`,
    });
    expect(noise).toEqual([]);
  });

  test('Reparent by drop', async ({ page }) => {
    await dropOn(page, 'c', 'p');
    await assertUndo(page, [{ ...ROOT, children: [S, { ...P, children: [Q, C] }] }, F, G]);
  });

  test('Detach to canvas', async ({ page }) => {
    const origin = await position(page, 'c');
    const grab = await screenPoint(page, { x: origin.x + 20, y: origin.y + 10 });
    expect(
      Number.isInteger(grab.x),
      'detach grab x must be representable in native mouse input',
    ).toBe(true);
    expect(
      Number.isInteger(grab.y),
      'detach grab y must be representable in native mouse input',
    ).toBe(true);
    const before = await begin(page, 'c');
    await movePointer(page, { x: 420, y: 310 });
    await expect.poll(() => position(page, 'c')).toEqual({ x: 400, y: 300 });
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
    await page.mouse.up();
    await expect.poll(() => position(page, 'c')).toEqual({ x: 400, y: 300 });
    await assertUndo(page, [
      { ...ROOT, children: [S, P] },
      F,
      G,
      { ...C, position: { x: 400, y: 300 } },
    ]);
    await expect.poll(() => position(page, 'c')).toEqual(before);
  });

  for (const [title, id, target] of [
    ['Refused cycle', 'c', 'd'],
    ['Primary root in the dragged set', 'r', 'f'],
    ['Self-drop refuses', 'c', 'c'],
  ] as const) {
    test(title, async ({ page }) => {
      await nodeAt(page, id).click();
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
      const destination = await position(page, target);
      const before = await begin(page, id);
      await movePointer(page, { x: 420, y: 310 });
      await expect.poll(() => position(page, id)).not.toEqual(before);
      await page.screenshot({ path: `${EVIDENCE}/drag-${id}-${target}-preview.png` });
      await movePointer(page, { x: destination.x + 20, y: destination.y + 10 });
      await page.mouse.up();
      await expect.poll(() => position(page, id)).toEqual(before);
      await expect(undo(page)).toBeDisabled();
      // Beyond the autosave debounce: unchanged updatedAt plus exact tree proves no saved mutation.
      await page.waitForTimeout(750);
      expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
      await page.getByRole('region').focus();
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => position(page, id)).toEqual(before);
      await expect(undo(page)).toBeDisabled();
    });
  }

  test('Floating root reposition', async ({ page }) => {
    await begin(page, 'f');
    await movePointer(page, { x: 420, y: 310 });
    await page.mouse.up();
    await expect.poll(() => position(page, 'f')).toEqual({ x: 400.25, y: 300.75 });
    await assertUndo(page, [ROOT, { ...F, position: { x: 400.25, y: 300.75 } }, G]);
    await expect.poll(() => position(page, 'f')).toEqual({ x: 700.25, y: 200.75 });
  });

  test('Floating root attachment', async ({ page }) => {
    await dropOn(page, 'f', 'p');
    const attached: MindNode = { id: 'f', text: 'Floating', children: F.children };
    await assertUndo(page, [{ ...ROOT, children: [S, C, { ...P, children: [Q, attached] }] }, G]);
    await expect.poll(() => position(page, 'f')).toEqual({ x: 700.25, y: 200.75 });
  });
});
