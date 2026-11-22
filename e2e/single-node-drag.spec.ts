import { expect, type Page } from '@playwright/test';
import { test } from './support/session';
import * as fs from 'node:fs';
import type { MindMap, MindNode, Position } from '../src/contexts/map/domain/types';
import { envelopeOf, readRecord, seedRecords } from './support/seed';
import { beginNativeMouseDrag, nativeCanvasPointer, translated } from './support/canvas-geometry';

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
// Empty text gives a font-independent 24px root width.
const ROOT: MindNode = { id: 'r', text: '', children: [S, C, P] };
const MAP: MindMap = {
  id: 'single-node-drag',
  title: '单节点拖动',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [ROOT, F, G],
};
const PREVIEW_POINTER = { x: 420, y: 310 };
const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const undo = (page: Page) => page.getByRole('button', { name: '撤销', exact: true });

async function position(page: Page, id: string): Promise<Position> {
  return nodeAt(page, id).evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f };
  });
}
async function dropOn(page: Page, id: string, target: string) {
  const destination = await position(page, target);
  const move = await beginNativeMouseDrag(page, await position(page, id));
  await move({ x: destination.x + 20, y: destination.y + 10 });
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

async function expectCancelledDrop(page: Page, id: string, origin: Position) {
  await expect.poll(() => position(page, id)).toEqual(origin);
  await expect(undo(page)).toBeDisabled();
  await page.waitForTimeout(750);
  expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
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
    const before = await position(page, 'c');
    const move = await beginNativeMouseDrag(page, before);
    const detached = translated(before, await move(PREVIEW_POINTER));
    await expect.poll(() => position(page, 'c')).toEqual(detached);
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
    await page.mouse.up();
    await expect.poll(() => position(page, 'c')).toEqual(detached);
    await assertUndo(page, [{ ...ROOT, children: [S, P] }, F, G, { ...C, position: detached }]);
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
      const before = await position(page, id);
      const move = await beginNativeMouseDrag(page, before);
      const preview = translated(before, await move(PREVIEW_POINTER));
      await expect.poll(() => position(page, id)).toEqual(preview);
      await page.screenshot({ path: `${EVIDENCE}/drag-${id}-${target}-preview.png` });
      await move({ x: destination.x + 20, y: destination.y + 10 });
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
    const before = { x: 700.25, y: 200.75 };
    await expect.poll(() => position(page, 'f')).toEqual(before);
    const move = await beginNativeMouseDrag(page, before);
    const dropped = translated(before, await move(PREVIEW_POINTER));
    await expect.poll(() => position(page, 'f')).toEqual(dropped);
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
    await page.mouse.up();
    await expect.poll(() => position(page, 'f')).toEqual(dropped);
    await assertUndo(page, [ROOT, { ...F, position: dropped }, G]);
    await expect.poll(() => position(page, 'f')).toEqual(before);
  });

  test('Floating root attachment', async ({ page }) => {
    await dropOn(page, 'f', 'p');
    const attached: MindNode = { id: 'f', text: 'Floating', children: F.children };
    await assertUndo(page, [{ ...ROOT, children: [S, C, { ...P, children: [Q, attached] }] }, G]);
    await expect.poll(() => position(page, 'f')).toEqual({ x: 700.25, y: 200.75 });
  });

  test.describe('native touch ownership', () => {
    test.use({ hasTouch: true });

    test('Second finger on the pane cancels a moving node and a fresh drag works', async ({
      page,
    }) => {
      const client = await page.context().newCDPSession(page);
      const origin = await position(page, 'c');
      const pointer = await nativeCanvasPointer(page);
      const initial = { id: 1, ...pointer.at({ x: origin.x + 20, y: origin.y + 10 }) };
      const moved = { id: 1, ...pointer.at(PREVIEW_POINTER) };
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [initial] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] });
      const preview = translated(origin, pointer.displacement(initial, moved));
      await expect.poll(() => position(page, 'c')).toEqual(preview);
      const canvas = await page.locator('.react-flow').boundingBox();
      if (canvas === null) throw new Error('missing canvas');
      const viewport = () =>
        page
          .locator('.react-flow__viewport')
          .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).e);
      const beforePan = await viewport();
      const edge = {
        id: 1,
        x: Math.trunc(canvas.x + canvas.width - 5),
        y: Math.trunc(canvas.y + 300),
      };
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [edge] });
      await expect.poll(viewport).toBeLessThan(beforePan);
      const pannedPointer = await nativeCanvasPointer(page);
      const second = { id: 2, ...pannedPointer.at({ x: 800, y: 500 }) };
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [edge, second],
      });
      const abortedMove = { ...edge, y: edge.y + 1 };
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [abortedMove, second],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const releasedViewport = await viewport();
      await expectCancelledDrop(page, 'c', origin);
      expect(await viewport()).toBe(releasedViewport);
      const freshPointer = await nativeCanvasPointer(page);
      const freshStart = { id: 7, ...freshPointer.at({ x: origin.x + 20, y: origin.y + 10 }) };
      const parentPosition = await position(page, 'p');
      const freshEnd = {
        id: 7,
        ...freshPointer.at({ x: parentPosition.x + 20, y: parentPosition.y + 10 }),
      };
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [freshStart],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [freshEnd] });
      const attachedPreview = translated(origin, freshPointer.displacement(freshStart, freshEnd));
      await expect.poll(() => position(page, 'c')).toEqual(attachedPreview);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await assertUndo(page, [{ ...ROOT, children: [S, { ...P, children: [Q, C] }] }, F, G]);
      await client.detach();
    });

    for (const touchedId of ['c', 'p']) {
      test(`Mouse and touch collision on ${touchedId} cannot commit either node`, async ({
        page,
      }) => {
        const client = await page.context().newCDPSession(page);
        const origin = await position(page, 'c');
        const move = await beginNativeMouseDrag(page, origin);
        const otherOrigin = await position(page, 'p');
        const preview = translated(origin, await move(PREVIEW_POINTER));
        await expect.poll(() => position(page, 'c')).toEqual(preview);
        const touched = await position(page, touchedId);
        const pointer = await nativeCanvasPointer(page);
        const initial = { id: 3, ...pointer.at({ x: touched.x + 20, y: touched.y + 10 }) };
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [initial],
        });
        const moved = { id: 3, ...pointer.at({ x: 620, y: 410 }) };
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] });
        await page.mouse.up();
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expectCancelledDrop(page, 'c', origin);
        await expect.poll(() => position(page, 'p')).toEqual(otherOrigin);
        const moveFresh = await beginNativeMouseDrag(page, origin);
        const detached = translated(origin, await moveFresh(PREVIEW_POINTER));
        await page.mouse.up();
        await assertUndo(page, [{ ...ROOT, children: [S, P] }, F, G, { ...C, position: detached }]);
        await client.detach();
      });
    }
  });
});
