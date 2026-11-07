import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import type { MindMap, MindNode, Position } from '../src/contexts/map/domain/types';
import { envelopeOf, readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });
// Empty titles have font-independent 24px widths. Separate roots give A/B an exact 80px gap.
const D: MindNode = { id: 'd', text: '', children: [] };
const E: MindNode = { id: 'e', text: '', children: [] };
const A: MindNode = { id: 'a', text: '', children: [D] };
const B: MindNode = { id: 'b', text: '', children: [E] };
const R: MindNode = { id: 'r', text: '', children: [A] };
const U: MindNode = { id: 'u', text: '', position: { x: 0, y: 80 }, children: [B] };
const Q: MindNode = { id: 'q', text: '', children: [] };
const P: MindNode = { id: 'p', text: '', position: { x: 600, y: 0 }, children: [Q] };
const FC: MindNode = { id: 'fc', text: '', children: [] };
const F: MindNode = {
  id: 'f',
  text: '',
  position: { x: 700.25, y: 200.75 },
  children: [FC],
};
const MAP: MindMap = {
  id: 'group-drag',
  title: '多节点拖动',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [R, U, P, F],
};
const IDS = ['r', 'a', 'd', 'u', 'b', 'e', 'p', 'q', 'f', 'fc'];
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
async function select(page: Page, ids: string[]) {
  for (const [index, id] of ids.entries()) {
    await nodeAt(page, id).click({ modifiers: index === 0 ? [] : ['Shift'] });
  }
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(ids.length);
}
async function begin(page: Page, id: string) {
  const origin = await position(page, id);
  const grab = await screenPoint(page, { x: origin.x + 20, y: origin.y + 10 });
  expect(Number.isInteger(grab.x), 'exact native grab x').toBe(true);
  expect(Number.isInteger(grab.y), 'exact native grab y').toBe(true);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  return origin;
}
async function move(page: Page, point: Position) {
  const screen = await screenPoint(page, point);
  expect(Number.isInteger(screen.x), 'exact native pointer x').toBe(true);
  expect(Number.isInteger(screen.y), 'exact native pointer y').toBe(true);
  await page.mouse.move(screen.x, screen.y, { steps: 12 });
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
async function expectRefused(page: Page, origins: Position[]) {
  await expect.poll(() => Promise.all(IDS.map((id) => position(page, id)))).toEqual(origins);
  await expect(undo(page)).toBeDisabled();
  await page.waitForTimeout(750);
  expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
  await page.getByRole('region', { name: '思维导图画布' }).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(undo(page)).toBeDisabled();
  expect(await Promise.all(IDS.map((id) => position(page, id)))).toEqual(origins);
}

const ATTACHED = [{ ...R, children: [] }, { ...U, children: [] }, { ...P, children: [Q, A, B] }, F];

test.describe('group drag', () => {
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
    await expect(nodeAt(page, 'fc')).toBeVisible();
    const canvas = await page.getByRole('region', { name: '思维导图画布' }).boundingBox();
    if (canvas === null) throw new Error('missing canvas');
    await page.mouse.move(canvas.x + 500, canvas.y + 300);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() =>
        page
          .locator('.react-flow__viewport')
          .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a),
      )
      .toBe(0.5);
    await expect.poll(() => position(page, 'a')).toEqual({ x: 56, y: 0 });
    await expect.poll(() => position(page, 'b')).toEqual({ x: 56, y: 80 });
    expect((await position(page, 'b')).y - (await position(page, 'a')).y).toBe(80);
    await expect(undo(page)).toBeDisabled();
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({
      path: `${EVIDENCE}/group-${info.title.replaceAll(/[^a-zA-Z0-9]+/g, '-')}.png`,
    });
    expect(noise).toEqual([]);
  });

  test('Group drag', async ({ page }) => {
    await select(page, ['b', 'a']);
    await begin(page, 'a');
    await move(page, { x: 420, y: 310 });
    await expect.poll(() => position(page, 'a')).toEqual({ x: 400, y: 300 });
    await expect.poll(() => position(page, 'b')).toEqual({ x: 400, y: 380 });
    await expect.poll(() => position(page, 'd')).toEqual({ x: 456, y: 300 });
    await expect.poll(() => position(page, 'e')).toEqual({ x: 456, y: 380 });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
    await page.screenshot({ path: `${EVIDENCE}/group-drag-preview.png` });
    await move(page, { x: 620, y: 10 });
    await page.mouse.up();
    await assertUndo(page, ATTACHED);
  });

  test('Nested selection moves once', async ({ page }) => {
    for (const grabbed of ['a', 'd']) {
      await select(page, ['a', 'd']);
      await begin(page, grabbed);
      await move(page, { x: 420, y: 310 });
      await expect
        .poll(() => position(page, 'a'))
        .toEqual(grabbed === 'a' ? { x: 400, y: 300 } : { x: 344, y: 300 });
      await expect
        .poll(() => position(page, 'd'))
        .toEqual(grabbed === 'a' ? { x: 456, y: 300 } : { x: 400, y: 300 });
      await expect.poll(() => position(page, 'b')).toEqual({ x: 56, y: 80 });
      await page.screenshot({ path: `${EVIDENCE}/group-nested-${grabbed}-preview.png` });
      await move(page, { x: 620, y: 10 });
      await page.mouse.up();
      await assertUndo(page, [{ ...R, children: [] }, U, { ...P, children: [Q, A] }, F]);
    }
  });

  test('Drop on a selected node is refused', async ({ page }) => {
    const origins = await Promise.all(IDS.map((id) => position(page, id)));
    await select(page, ['b', 'a']);
    await begin(page, 'a');
    await move(page, { x: 420, y: 310 });
    await expect.poll(() => position(page, 'a')).toEqual({ x: 400, y: 300 });
    await expect.poll(() => position(page, 'b')).toEqual({ x: 400, y: 380 });
    await page.screenshot({ path: `${EVIDENCE}/group-refused-preview.png` });
    await move(page, { x: 76, y: 90 });
    await page.mouse.up();
    await expectRefused(page, origins);
  });

  test('Group detach to canvas', async ({ page }) => {
    await select(page, ['b', 'a']);
    await begin(page, 'a');
    await move(page, { x: 420, y: 310 });
    await expect.poll(() => position(page, 'a')).toEqual({ x: 400, y: 300 });
    await expect.poll(() => position(page, 'b')).toEqual({ x: 400, y: 380 });
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
    await page.mouse.up();
    await assertUndo(page, [
      { ...R, children: [] },
      { ...U, children: [] },
      P,
      F,
      { ...A, position: { x: 400, y: 300 } },
      { ...B, position: { x: 400, y: 380 } },
    ]);
    await expect.poll(() => position(page, 'a')).toEqual({ x: 56, y: 0 });
    await expect.poll(() => position(page, 'b')).toEqual({ x: 56, y: 80 });
  });

  test('Primary root refuses the whole selected group', async ({ page }) => {
    const origins = await Promise.all(IDS.map((id) => position(page, id)));
    await select(page, ['r', 'b']);
    await begin(page, 'r');
    await move(page, { x: 420, y: 310 });
    await expect.poll(() => position(page, 'r')).toEqual({ x: 400, y: 300 });
    await expect.poll(() => position(page, 'b')).toEqual({ x: 456, y: 380 });
    await page.screenshot({ path: `${EVIDENCE}/group-primary-preview.png` });
    await move(page, { x: 620, y: 10 });
    await page.mouse.up();
    await expectRefused(page, origins);
  });

  test('Mixed tree and floating group preserves exact fractional offsets', async ({ page }) => {
    await expect.poll(() => position(page, 'f')).toEqual({ x: 700.25, y: 200.75 });
    await select(page, ['f', 'a']);
    await begin(page, 'a');
    await move(page, { x: 420, y: 310 });
    await expect.poll(() => position(page, 'a')).toEqual({ x: 400, y: 300 });
    await expect.poll(() => position(page, 'f')).toEqual({ x: 1044.25, y: 500.75 });
    await expect.poll(() => position(page, 'fc')).toEqual({ x: 1100.25, y: 500.75 });
    await page.mouse.up();
    await assertUndo(page, [
      { ...R, children: [] },
      U,
      P,
      { ...F, position: { x: 1044.25, y: 500.75 } },
      { ...A, position: { x: 400, y: 300 } },
    ]);
    await expect.poll(() => position(page, 'f')).toEqual({ x: 700.25, y: 200.75 });
  });

  test.describe('native group ownership', () => {
    test.use({ hasTouch: true });
    test('Group native abort resets all previews and stops edge autopan', async ({ page }) => {
      await select(page, ['b', 'a']);
      const origins = await Promise.all(IDS.map((id) => position(page, id)));
      const client = await page.context().newCDPSession(page);
      const initial = await screenPoint(page, { x: 76, y: 10 });
      const moved = await screenPoint(page, { x: 420, y: 310 });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 1, ...initial }],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 1, ...moved }],
      });
      await expect.poll(() => position(page, 'a')).toEqual({ x: 400, y: 300 });
      await expect.poll(() => position(page, 'b')).toEqual({ x: 400, y: 380 });
      const canvas = await page.locator('.react-flow').boundingBox();
      if (canvas === null) throw new Error('missing canvas');
      const viewport = () =>
        page
          .locator('.react-flow__viewport')
          .evaluate((element) => getComputedStyle(element).transform);
      const beforePan = await viewport();
      const edge = {
        id: 1,
        x: Math.trunc(canvas.x + canvas.width - 5),
        y: Math.trunc(canvas.y + 300),
      };
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [edge] });
      await expect.poll(viewport).not.toBe(beforePan);
      await page.screenshot({ path: `${EVIDENCE}/group-edge-preview.png` });
      const second = { id: 2, x: Math.trunc(canvas.x + 600), y: Math.trunc(canvas.y + 400) };
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [edge, second],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...edge, y: edge.y + 1 }, second],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const released = await viewport();
      await expectRefused(page, origins);
      expect(await viewport()).toBe(released);
      const fresh = await screenPoint(page, { x: 76, y: 10 });
      const destination = await screenPoint(page, { x: 620, y: 10 });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 7, ...fresh }],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 7, ...destination }],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await assertUndo(page, ATTACHED);
      await client.detach();
    });
  });
});
