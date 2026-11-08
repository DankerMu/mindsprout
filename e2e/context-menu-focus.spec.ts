import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import {
  A,
  B,
  C,
  F,
  MAP,
  ROOT,
  item,
  loadMap,
  nodeAt,
  open,
  redo,
  restore,
  roots,
  undo,
} from './support/context-menu';
import { envelopeOf, readRecord } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });

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

  test('Disabled primary-root Delete preserves native pointer focus and keyboard dismissal', async ({
    page,
  }) => {
    await nodeAt(page, 'a').click();
    await open(page, 'r');
    const menu = page.getByRole('menu', { name: '节点菜单', exact: true });
    const first = item(page, '添加子节点');
    const disabledDelete = item(page, '删除');
    await expect(first).toBeEnabled();
    await expect(first).toBeFocused();
    await expect(disabledDelete).toBeDisabled();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(nodeAt(page, 'a')).toHaveClass(/selected/);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);

    const box = await disabledDelete.boundingBox();
    if (box === null) throw new Error('missing disabled Delete geometry');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(menu).toBeVisible();
    expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item(page, '重命名')).toBeEnabled();
    await expect(item(page, '重命名')).toBeFocused();
    await page.screenshot({ path: `${EVIDENCE}/menu-disabled-pointer-focus.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('region')).toBeFocused();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(nodeAt(page, 'a')).toHaveClass(/selected/);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
  });

  test('Primary-root menu padding preserves native pointer focus and keyboard dismissal', async ({
    page,
  }) => {
    await nodeAt(page, 'a').click();
    await open(page, 'r');
    const menu = page.getByRole('menu', { name: '节点菜单', exact: true });
    const first = item(page, '添加子节点');
    await expect(first).toBeEnabled();
    await expect(first).toBeFocused();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(nodeAt(page, 'a')).toHaveClass(/selected/);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);

    const box = await menu.boundingBox();
    if (box === null) throw new Error('missing menu padding geometry');
    const point = { x: box.x + box.width / 2, y: box.y + 2 };
    expect(
      await menu.evaluate(
        (element, point) => document.elementFromPoint(point.x, point.y) === element,
        point,
      ),
    ).toBe(true);
    await page.mouse.click(point.x, point.y);

    await expect(menu).toBeVisible();
    expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item(page, '重命名')).toBeEnabled();
    await expect(item(page, '重命名')).toBeFocused();
    await page.screenshot({ path: `${EVIDENCE}/menu-padding-pointer-focus.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('region')).toBeFocused();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(nodeAt(page, 'a')).toHaveClass(/selected/);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
  });

  test('Enabled menu pointer action creates exactly one sibling with one-step undo', async ({
    page,
  }) => {
    await nodeAt(page, 'a').click();
    await open(page, 'b');
    await expect(item(page, '添加子节点')).toBeFocused();
    await expect(item(page, '添加兄弟节点')).toBeEnabled();
    await item(page, '添加兄弟节点').click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    const input = page.getByRole('textbox', { name: '节点标题' });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    const selected = page.locator('.react-flow__node.selected');
    await expect(selected).toHaveCount(1);
    const id = await selected.getAttribute('data-id');
    if (id === null) throw new Error('created sibling has no id');
    await input.fill('Pointer sibling');
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(page.getByRole('region')).toBeFocused();
    await expect(page.locator('.react-flow__node')).toHaveCount(15);
    await expect
      .poll(() => roots(page))
      .toEqual([
        {
          ...ROOT,
          children: [A, B, { id, text: 'Pointer sibling', children: [] }, C],
        },
        F,
      ]);
    await expect(undo(page)).toBeEnabled();
    await expect(redo(page)).toBeDisabled();
    await page.screenshot({ path: `${EVIDENCE}/menu-enabled-pointer-sibling.png` });
    await restore(page);
    await expect(nodeAt(page, id)).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(14);
    await expect(redo(page)).toBeEnabled();
  });

  test('Title input right-click preserves native context menu focus and draft', async ({
    page,
  }) => {
    await nodeAt(page, 'a').dblclick();
    const input = page.getByRole('textbox', { name: '节点标题' });
    await expect(input).toBeFocused();
    await input.fill('Uncommitted title draft');
    const events = await input.evaluateHandle((element) => {
      const captured: Event[] = [];
      element.addEventListener(
        'contextmenu',
        (event) => {
          captured.push(event);
        },
        { capture: true, once: true },
      );
      return captured;
    });

    await input.click({ button: 'right' });
    expect(
      await events.evaluate((captured) =>
        captured.map((event) => ({
          type: event.type,
          trusted: event.isTrusted,
          defaultPrevented: event.defaultPrevented,
        })),
      ),
    ).toEqual([{ type: 'contextmenu', trusted: true, defaultPrevented: false }]);
    await events.dispose();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Uncommitted title draft');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(nodeAt(page, 'a')).toHaveClass(/selected/);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    expect(await readRecord(page, MAP.id)).toEqual(envelopeOf(MAP).value);
  });
});
