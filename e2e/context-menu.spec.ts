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
async function nodeStyle(page: Page, id: string) {
  return nodeAt(page, id)
    .locator('.mind-node')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color, shadow: style.boxShadow };
    });
}
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
async function restore(page: Page, expected = MAP.roots) {
  await expect(undo(page)).toBeEnabled();
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  await expect.poll(() => roots(page)).toEqual(expected);
}
async function selectThree(page: Page) {
  await nodeAt(page, 'a').click();
  await nodeAt(page, 'b').click({ modifiers: ['Shift'] });
  await nodeAt(page, 'c').click({ modifiers: ['Shift'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);
}
async function loadMap(page: Page, map = MAP) {
  await seedRecords(page, [envelopeOf(map)]);
  await page.goto(`/maps/${map.id}`);
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  await page.getByRole('button', { name: '适应画布' }).click();
  await expect(nodeAt(page, 'fd')).toBeVisible();
}
async function chooseColor(page: Page, id: string, color: string) {
  await open(page, id);
  await item(page, '设置颜色').click();
  await item(page, color).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
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
    await loadMap(page);
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

  test('Set color from the menu', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await nodeAt(page, 'a').click();
    const colored = nodeAt(page, 'a').locator('.mind-node');
    const before = await nodeStyle(page, 'a');
    await chooseColor(page, 'a', 'blue');
    await expect(colored).toHaveClass(/mind-node--color-blue/);
    await expect
      .poll(async () => (await nodeStyle(page, 'a')).background)
      .not.toBe(before.background);
    await expect
      .poll(() => roots(page))
      .toEqual([{ ...ROOT, children: [{ ...A, color: 'blue' }, B, C] }, F]);
    await page.screenshot({ path: `${EVIDENCE}/color-set-blue.png` });
    await restore(page);
    await expect(colored).not.toHaveClass(/mind-node--color-/);
    await page.reload();
    await expect(nodeAt(page, 'a')).toBeVisible();
    expect(await roots(page)).toEqual(MAP.roots);
  });

  test('Clear a color from the menu', async ({ page }) => {
    const initial: MindMap = {
      ...MAP,
      roots: [{ ...ROOT, children: [{ ...A, color: 'blue' }, B, C] }, F],
    };
    await loadMap(page, initial);
    await nodeAt(page, 'a').click();
    await chooseColor(page, 'a', '无颜色');
    await expect(nodeAt(page, 'a').locator('.mind-node')).not.toHaveClass(/mind-node--color-/);
    await expect.poll(() => roots(page)).toEqual(MAP.roots);
    await restore(page, initial.roots);
    await expect(nodeAt(page, 'a').locator('.mind-node')).toHaveClass(/mind-node--color-blue/);
    await page.reload();
    await expect(nodeAt(page, 'a').locator('.mind-node')).toHaveClass(/mind-node--color-blue/);
    expect(await roots(page)).toEqual(initial.roots);
  });

  test('Group color', async ({ page }) => {
    const initial: MindMap = {
      ...MAP,
      roots: [
        {
          ...ROOT,
          children: [{ ...A, color: 'red', children: [{ ...AA, color: 'purple' }, AB] }, B, C],
        },
        F,
      ],
    };
    await loadMap(page, initial);
    await nodeAt(page, 'a').click();
    await nodeAt(page, 'aa').click({ modifiers: ['Shift'] });
    await nodeAt(page, 'b').click({ modifiers: ['Shift'] });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);
    await chooseColor(page, 'a', 'green');
    for (const id of ['a', 'aa', 'b']) {
      await expect(nodeAt(page, id)).toHaveClass(/selected/);
      await expect(nodeAt(page, id).locator('.mind-node')).toHaveClass(/mind-node--color-green/);
    }
    await expect
      .poll(() => roots(page))
      .toEqual([
        {
          ...ROOT,
          children: [
            { ...A, color: 'green', children: [{ ...AA, color: 'green' }, AB] },
            { ...B, color: 'green' },
            C,
          ],
        },
        F,
      ]);
    await page.screenshot({ path: `${EVIDENCE}/color-group-green.png` });
    await restore(page, initial.roots);
    await expect(nodeAt(page, 'a').locator('.mind-node')).toHaveClass(/mind-node--color-red/);
    await expect(nodeAt(page, 'aa').locator('.mind-node')).toHaveClass(/mind-node--color-purple/);
    await expect(nodeAt(page, 'b').locator('.mind-node')).not.toHaveClass(/mind-node--color-/);
    await page.reload();
    await expect(nodeAt(page, 'aa')).toBeVisible();
    expect(await roots(page)).toEqual(initial.roots);
  });

  test('Color submenu owns native keyboard focus within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 });
    await page.getByRole('button', { name: '适应画布' }).click();
    await nodeAt(page, 'a').click();
    await open(page, 'f');
    const trigger = item(page, '设置颜色');
    await trigger.focus();
    await page.keyboard.press('ArrowRight');
    await expect(item(page, 'red')).toBeFocused();
    for (const name of ['节点菜单', '设置颜色']) {
      const box = await page.getByRole('menu', { name, exact: true }).boundingBox();
      if (box === null) throw new Error(`missing menu geometry for ${name}`);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(640);
      expect(box.y + box.height).toBeLessThanOrEqual(480);
    }
    await page.screenshot({ path: `${EVIDENCE}/color-keyboard-submenu.png` });
    await page.keyboard.press('End');
    await expect(item(page, '无颜色')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item(page, 'red')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('menu', { name: '设置颜色', exact: true })).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(item(page, 'red')).toBeFocused();
    for (const key of ['ControlOrMeta+Enter', 'ControlOrMeta+z', 'Delete', 'Backspace']) {
      await page.keyboard.press(key);
      await expect(item(page, 'red')).toBeFocused();
    }
    await expect(undo(page)).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Space');
    await expect(item(page, 'red')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('region')).toBeFocused();
    await expect(nodeAt(page, 'a')).toHaveClass(/selected/);
    expect(await roots(page)).toEqual(MAP.roots);
    await open(page, 'f');
    await trigger.focus();
    await page.keyboard.press('ArrowRight');
    for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowDown');
    await expect(item(page, 'blue')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('region')).toBeFocused();
    await expect.poll(() => roots(page)).toEqual([ROOT, { ...F, color: 'blue' }]);
    await expect(nodeAt(page, 'a')).toHaveClass(/selected/);
    await restore(page);
  });

  test('Six color tokens retain their selected backgrounds in light and dark themes', async ({
    page,
  }, info) => {
    const palette = [
      { id: 'a', token: 'red' },
      { id: 'aa', token: 'orange' },
      { id: 'ab', token: 'yellow' },
      { id: 'b', token: 'green' },
      { id: 'c', token: 'blue' },
      { id: 'f', token: 'purple' },
    ];
    for (const { id, token } of palette) await chooseColor(page, id, token);
    const observations = [];
    const plainObservations = [];
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const plain = nodeAt(page, 'r').locator('.mind-node');
      await expect(plain).toHaveAttribute('aria-pressed', 'false');
      const plainUnselected = await nodeStyle(page, 'r');
      await nodeAt(page, 'r').click();
      await expect(plain).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(async () => (await nodeStyle(page, 'r')).background)
        .not.toBe(plainUnselected.background);
      const plainSelected = await nodeStyle(page, 'r');
      expect(plainSelected.shadow).not.toBe(plainUnselected.shadow);
      expect(plainSelected.shadow).not.toBe('none');
      plainObservations.push({ scheme, unselected: plainUnselected, selected: plainSelected });
      for (const { id, token } of palette) {
        const colored = nodeAt(page, id).locator('.mind-node');
        await expect(colored).toHaveClass(new RegExp(`mind-node--color-${token}`));
        await expect(colored).toHaveAttribute('aria-pressed', 'false');
        const unselected = await nodeStyle(page, id);
        expect(unselected.background).not.toBe(plainUnselected.background);
        expect(unselected.background).not.toBe(plainSelected.background);
        await nodeAt(page, id).click();
        await expect(colored).toHaveAttribute('aria-pressed', 'true');
        const selected = await nodeStyle(page, id);
        expect(selected.background).toBe(unselected.background);
        expect(selected.shadow).not.toBe(unselected.shadow);
        expect(selected.shadow).not.toBe('none');
        observations.push({ scheme, token, unselected, selected });
      }
      await expect(plain).toHaveCSS('background-color', plainUnselected.background);
      expect(
        new Set(
          observations
            .filter((observation) => observation.scheme === scheme)
            .map((observation) => observation.unselected.background),
        ).size,
      ).toBe(palette.length);
      await page.screenshot({ path: `${EVIDENCE}/color-theme-${scheme}.png` });
    }
    for (const { token } of palette) {
      const light = observations.find((entry) => entry.scheme === 'light' && entry.token === token);
      const dark = observations.find((entry) => entry.scheme === 'dark' && entry.token === token);
      expect(light).toBeDefined();
      expect(dark).toBeDefined();
      expect(dark?.unselected.background).not.toBe(light?.unselected.background);
    }
    await info.attach('computed-node-colors', {
      body: JSON.stringify({ tokens: observations, plain: plainObservations }, null, 2),
      contentType: 'application/json',
    });
  });
});
