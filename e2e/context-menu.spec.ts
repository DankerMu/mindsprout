import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import type { MindMap, MindNode } from '../src/contexts/map/domain/types';
import { envelopeOf, readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });
const AA: MindNode = { id: 'aa', text: 'AA', children: [] };
const AB: MindNode = {
  id: 'ab',
  text: 'AB',
  children: [
    { id: 'aba', text: 'ABA', children: [] },
    { id: 'abb', text: 'ABB', children: [] },
  ],
};
const A: MindNode = { id: 'a', text: 'A', children: [AA, AB] };
const B: MindNode = { id: 'b', text: 'B', children: [{ id: 'ba', text: 'BA', children: [] }] };
const C: MindNode = { id: 'c', text: 'C', children: [{ id: 'ca', text: 'CA', children: [] }] };
const ROOT: MindNode = { id: 'r', text: 'Root', children: [A, B, C] };
const FC: MindNode = {
  id: 'fc',
  text: 'Detach C',
  children: [{ id: 'fd', text: 'Descendant', children: [] }],
};
const FS: MindNode = { id: 'fs', text: 'Before C', children: [] };
const F: MindNode = {
  id: 'f',
  // Empty text gives a font-independent 24px width and an exactly representable CSSOM position.
  text: '',
  position: { x: 700.25, y: 200.75 },
  children: [FS, FC],
};
const MAP: MindMap = {
  id: 'context-menu',
  title: '节点菜单',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [ROOT, F],
};
const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const item = (page: Page, label: string) =>
  page.getByRole('menuitem', { name: label, exact: true });
const undo = (page: Page) => page.getByRole('button', { name: '撤销', exact: true });
async function open(page: Page, id: string) {
  await nodeAt(page, id).click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
}
async function position(page: Page, id: string) {
  return nodeAt(page, id).evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f };
  });
}
async function roots(page: Page) {
  const record = (await readRecord(page, MAP.id)) as { map: MindMap };
  return record.map.roots;
}
async function restore(page: Page) {
  await expect(undo(page)).toBeEnabled();
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  await expect.poll(() => roots(page)).toEqual(MAP.roots);
}
async function selectThree(page: Page) {
  await nodeAt(page, 'a').click();
  await nodeAt(page, 'b').click({ modifiers: ['Shift'] });
  await nodeAt(page, 'c').click({ modifiers: ['Shift'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);
}

test.describe('node context menu', () => {
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
    await page.getByRole('button', { name: '适应画布' }).click();
    await expect(nodeAt(page, 'fd')).toBeVisible();
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({
      path: `${EVIDENCE}/menu-${info.title.replaceAll(/[^a-zA-Z0-9]+/g, '-')}.png`,
    });
    expect(noise).toEqual([]);
  });

  test('Menu on a floating root', async ({ page }) => {
    await nodeAt(page, 'a').click();
    await open(page, 'f');
    await expect(page.getByRole('menuitem')).toHaveCount(6);
    await expect(item(page, '添加兄弟节点')).toBeDisabled();
    await expect(item(page, '脱离为浮动节点')).toBeDisabled();
    await expect(item(page, '删除')).toBeEnabled();
    await expect(nodeAt(page, 'a')).toHaveClass(/selected/);
    await item(page, '删除').click();
    await expect(nodeAt(page, 'f')).toHaveCount(0);
    await expect(nodeAt(page, 'fc')).toHaveCount(0);
    await expect(nodeAt(page, 'fd')).toHaveCount(0);
    await expect.poll(() => roots(page)).toEqual([ROOT]);
    await restore(page);
  });

  test('Detach from the menu', async ({ page }) => {
    const viewport = await page.locator('.react-flow__viewport').evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { x: matrix.e, y: matrix.f, zoom: matrix.a };
    });
    expect(viewport).not.toEqual({ x: 0, y: 0, zoom: 1 });
    const before = await position(page, 'fc');
    expect(before).toEqual({ x: 756.25, y: 232.75 });
    expect(before.x).not.toBe(0);
    expect(before.y).not.toBe(0);
    expect(Number.isInteger(before.x) && Number.isInteger(before.y)).toBe(false);
    await selectThree(page);
    await open(page, 'fc');
    await item(page, '脱离为浮动节点').click();
    await expect.poll(() => position(page, 'fc')).toEqual(before);
    await expect
      .poll(() => roots(page))
      .toEqual([ROOT, { ...F, children: [FS] }, { ...FC, position: before }]);
    await expect(nodeAt(page, 'fd')).toBeVisible();
    await restore(page);
    await expect.poll(() => position(page, 'fc')).toEqual(before);
    await page.reload();
    await expect(nodeAt(page, 'fd')).toBeVisible();
    expect(await roots(page)).toEqual(MAP.roots);
  });

  test('Collapse with three nodes selected', async ({ page }) => {
    await selectThree(page);
    await open(page, 'b');
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);
    await item(page, '折叠').click();
    await expect(nodeAt(page, 'ba')).toHaveCount(0);
    await expect(nodeAt(page, 'aa')).toBeVisible();
    await expect(nodeAt(page, 'ca')).toBeVisible();
    await expect
      .poll(() => roots(page))
      .toEqual([{ ...ROOT, children: [A, { ...B, collapsed: true }, C] }, F]);
    await restore(page);
  });

  test('Collapse and expand', async ({ page }) => {
    const ids = ['aa', 'aba', 'abb'];
    const before = await Promise.all(ids.map((id) => position(page, id)));
    const gap = (await position(page, 'b')).y - (await position(page, 'a')).y;
    await open(page, 'a');
    await item(page, '折叠').click();
    for (const id of ['aa', 'ab', 'aba', 'abb']) await expect(nodeAt(page, id)).toHaveCount(0);
    const indicator = nodeAt(page, 'a').getByRole('img', { name: '已折叠 4 个节点' });
    await expect(indicator).toHaveText('4');
    await expect
      .poll(async () => (await position(page, 'b')).y - (await position(page, 'a')).y)
      .toBeLessThan(gap);
    await indicator.click();
    await expect(nodeAt(page, 'aa')).toHaveCount(0);
    await open(page, 'a');
    await item(page, '展开').click();
    for (const id of ['aa', 'ab', 'aba', 'abb']) await expect(nodeAt(page, id)).toBeVisible();
    await expect.poll(() => Promise.all(ids.map((id) => position(page, id)))).toEqual(before);
    await expect.poll(() => roots(page)).toEqual(MAP.roots);
  });

  test('Menu creation and rename retain input focus and one-step history', async ({ page }) => {
    for (const label of ['添加子节点', '添加兄弟节点', '重命名']) {
      await selectThree(page);
      await open(page, 'b');
      await item(page, label).click();
      const input = page.getByLabel('节点标题');
      await expect(input).toBeFocused();
      await input.fill('菜单输入');
      await input.press('Enter');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect
        .poll(async () => {
          const children = (await roots(page))[0]?.children;
          if (label === '添加子节点') return children?.[1]?.children.map((child) => child.text);
          return children?.map((child) => child.text);
        })
        .toEqual(
          label === '添加子节点'
            ? ['BA', '菜单输入']
            : label === '添加兄弟节点'
              ? ['A', 'B', '菜单输入', 'C']
              : ['A', '菜单输入', 'C'],
        );
      await restore(page);
    }
  });

  test('Selected delete, dismissal and keyboard ownership', async ({ page }) => {
    await selectThree(page);
    await open(page, 'r');
    await expect(item(page, '删除')).toBeDisabled();
    await expect(item(page, '添加兄弟节点')).toBeDisabled();
    await expect(item(page, '脱离为浮动节点')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);
    await open(page, 'a');
    for (const key of ['ControlOrMeta+z', 'Delete', 'Backspace', 'ControlOrMeta+Enter'])
      await page.keyboard.press(key);
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(undo(page)).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(750);
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
    await open(page, 'b');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(item(page, '删除')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => roots(page)).toEqual([{ ...ROOT, children: [] }, F]);
    await restore(page);
    await open(page, 'a');
    await nodeAt(page, 'c').click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(nodeAt(page, 'c')).toHaveClass(/selected/);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  });
});
