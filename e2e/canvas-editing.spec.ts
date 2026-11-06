import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { envelopeOf, readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });
const leaf = (id: string) => ({ id, text: id.toUpperCase(), children: [] });
const MAP = {
  id: 'selection',
  title: '选择与导航',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [
    {
      id: 'r',
      text: '中心主题',
      children: [
        leaf('a'),
        {
          id: 'b',
          text: '折叠主题',
          collapsed: true,
          children: [leaf('hidden1'), leaf('hidden2')],
        },
        leaf('c'),
      ],
    },
    { id: 'f', text: '浮动主题', position: { x: 500, y: 300 }, children: [leaf('fc')] },
  ],
};
const RECORD = envelopeOf(MAP);

const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function selected(page: Page, ids: string[]): Promise<void> {
  await expect
    .poll(() =>
      page
        .locator('.react-flow__node.selected')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-id')).sort(),
        ),
    )
    .toEqual([...ids].sort());
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(ids.length);
}

async function boxOf(page: Page, id: string) {
  const box = await nodeAt(page, id).boundingBox();
  if (box === null) throw new Error(`missing box for ${id}`);
  return box;
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${EVIDENCE}/canvas-selection-${name}.png` });
}

test.describe('canvas-editing selection', () => {
  let noise: string[];
  test.beforeEach(async ({ page }) => {
    noise = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        noise.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      noise.push(`pageerror: ${String(error)}`);
    });
    await seedRecords(page, [RECORD]);
    await page.goto('/maps/selection');
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    for (const id of ['r', 'a', 'b', 'c', 'f', 'fc']) await expect(nodeAt(page, id)).toBeVisible();
    await page.getByRole('button', { name: '适应画布' }).click();
  });

  test.afterEach(async ({ page }) => {
    await page.waitForTimeout(600);
    expect(await readRecord(page, RECORD.key)).toStrictEqual(RECORD.value);
    expect(noise).toEqual([]);
  });

  test('Rubber-band selection', async ({ page }) => {
    await nodeAt(page, 'f').click();
    const boxes = await Promise.all(['a', 'b', 'c'].map((id) => boxOf(page, id)));
    const left = Math.min(...boxes.map((box) => box.x)) - 8;
    const top = Math.min(...boxes.map((box) => box.y)) - 8;
    const right = Math.max(...boxes.map((box) => box.x + box.width)) + 8;
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 8;
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 12 });
    await page.mouse.up();
    await selected(page, ['a', 'b', 'c']);
    await capture(page, 'rubber-band');
    // Partial enclosure excludes C, and a reverse drag uses the same containment rule.
    const partial = await boxOf(page, 'c');
    await page.mouse.move(right, partial.y + partial.height / 2);
    await page.mouse.down();
    await page.mouse.move(left, top, { steps: 12 });
    await page.mouse.up();
    await selected(page, ['a', 'b']);
  });

  test('Arrow navigation', async ({ page }) => {
    await nodeAt(page, 'r').click();
    await page.keyboard.press('ArrowRight');
    await selected(page, ['a']);
    await page.keyboard.press('ArrowDown');
    await selected(page, ['b']);
    await page.keyboard.press('ArrowUp');
    await selected(page, ['a']);
    await page.keyboard.press('ArrowUp');
    await selected(page, ['a']);
    await page.keyboard.press('ArrowLeft');
    await selected(page, ['r']);
    await capture(page, 'arrows');
  });

  test('Arrow right on a collapsed node', async ({ page }) => {
    await nodeAt(page, 'b').click();
    await page.keyboard.press('ArrowRight');
    await selected(page, ['b']);
    await expect(nodeAt(page, 'hidden1')).toHaveCount(0);
    await expect(nodeAt(page, 'hidden2')).toHaveCount(0);
    await capture(page, 'collapsed-right');
  });

  test('Arrow left on a floating root', async ({ page }) => {
    await nodeAt(page, 'f').click();
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowDown']) {
      await page.keyboard.press(key);
      await selected(page, ['f']);
    }
    await capture(page, 'floating-left');
  });

  test('Three-node click and Shift selection preserves the last-click primary', async ({
    page,
  }) => {
    await nodeAt(page, 'a').click();
    await nodeAt(page, 'b').click({ modifiers: ['Shift'] });
    await nodeAt(page, 'c').click({ modifiers: ['Shift'] });
    await selected(page, ['a', 'b', 'c']);
    await capture(page, 'three-selected');
    await page.keyboard.press('ArrowUp');
    await selected(page, ['b']);
    await nodeAt(page, 'fc').click({ modifiers: ['Shift'] });
    await page.keyboard.press('ArrowLeft');
    await selected(page, ['f']);
    await nodeAt(page, 'a').click({ modifiers: ['Shift'] });
    await nodeAt(page, 'a').click({ modifiers: ['Shift'] });
    await selected(page, ['f']);
  });

  test('Select all visible nodes and Escape clear', async ({ page }) => {
    await nodeAt(page, 'b').click();
    for (const key of ['Control+a', 'Meta+a']) {
      await page.keyboard.press(key);
      await selected(page, ['r', 'a', 'b', 'c', 'f', 'fc']);
      await capture(page, key.startsWith('Control') ? 'select-all' : 'meta-select-all');
      await page.keyboard.press('Escape');
      await selected(page, []);
      await page.keyboard.press('ArrowRight');
      await selected(page, []);
    }
    await capture(page, 'escape');
  });

  test('Space and middle pan over selected nodes preserve selection', async ({ page }) => {
    await nodeAt(page, 'a').click();
    await nodeAt(page, 'b').click({ modifiers: ['Shift'] });
    await nodeAt(page, 'c').click({ modifiers: ['Shift'] });
    const viewport = page.locator('.react-flow__viewport');
    const positions = await page
      .locator('.react-flow__node')
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLElement).style.transform),
      );
    for (const button of ['left', 'middle'] as const) {
      const before = await viewport.getAttribute('style');
      const box = await boxOf(page, 'b');
      if (button === 'left') await page.keyboard.down('Space');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down({ button });
      await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 30, { steps: 10 });
      await page.mouse.up({ button });
      if (button === 'left') await page.keyboard.up('Space');
      await selected(page, ['a', 'b', 'c']);
      expect(await viewport.getAttribute('style')).not.toBe(before);
    }
    expect(
      await page
        .locator('.react-flow__node')
        .evaluateAll((elements) =>
          elements.map((element) => (element as HTMLElement).style.transform),
        ),
    ).toEqual(positions);
    await capture(page, 'selected-pan');
  });
});
