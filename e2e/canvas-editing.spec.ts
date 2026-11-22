import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './support/session';
import * as fs from 'node:fs';
import { envelopeOf, readRecord, seedRecords } from './support/seed';
import type { MindMap } from '../src/contexts/map/domain/types';
import { panAcrossCanvas } from './support/canvas-geometry';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });
let noise: string[];
test.beforeEach(({ page }) => {
  noise = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      noise.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    noise.push(`pageerror: ${String(error)}`);
  });
});
test.afterEach(() => {
  expect(noise).toEqual([]);
});

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
const canvasAt = (page: Page) => page.getByRole('region', { name: '思维导图画布' });

function viewportOf(page: Page) {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

async function expectInsideCanvas(nodes: Locator, count: number) {
  await expect(nodes).toHaveCount(count);
  await expect
    .poll(() =>
      nodes.evaluateAll((elements) => {
        const canvas = document.querySelector('.react-flow');
        if (canvas === null) throw new Error('missing canvas');
        const rect = canvas.getBoundingClientRect();
        return elements.map((element) => {
          const box = element.getBoundingClientRect();
          return (
            getComputedStyle(element).visibility === 'visible' &&
            Math.min(
              box.left - rect.left,
              box.top - rect.top,
              rect.right - box.right,
              rect.bottom - box.bottom,
            ) > 1
          );
        });
      }),
    )
    .toEqual(Array<boolean>(count).fill(true));
}

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

async function openBlankMap(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建导图' }).click();
  await expect(page).toHaveURL(/\/maps\/[^/?#]+$/);
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
}

test('opens a new root and a measured forest inside the canvas without manual fit', async ({
  page,
}) => {
  await openBlankMap(page);
  const nodes = page.locator('.react-flow__node');
  await expectInsideCanvas(nodes, 1);
  expect((await viewportOf(page)).zoom).toBe(1);
  await capture(page, 'initial-root');

  await seedRecords(page, [RECORD]);
  await page.goto('/maps/selection');
  await expectInsideCanvas(nodes, 6);
  const framed = await viewportOf(page);
  expect(framed.zoom).toBeGreaterThanOrEqual(0.25);
  expect(framed.zoom).toBeLessThanOrEqual(1);
  await capture(page, 'initial-forest');

  await page.mouse.move(20, 200);
  await page.mouse.wheel(300, 300);
  await expect.poll(() => viewportOf(page)).not.toEqual(framed);
  await page.reload();
  await expectInsideCanvas(nodes, 6);
  await expect.poll(() => viewportOf(page)).toEqual(framed);
  expect(await readRecord(page, RECORD.key)).toStrictEqual(RECORD.value);
});

test('keyboard-created siblings stay clickable before and after reopening', async ({ page }) => {
  await openBlankMap(page);
  const nodes = page.locator('.react-flow__node');
  await expectInsideCanvas(nodes, 1);
  await nodes.click();
  const input = page.getByRole('textbox', { name: '节点标题' });
  const children = [
    ['Tab', '分支甲'],
    ['Enter', '分支乙'],
  ] as const;
  for (const [key, title] of children) {
    await page.keyboard.press(key);
    await expect(input).toBeFocused();
    await input.fill(title);
    await input.press('Enter');
  }
  const mapId = new URL(page.url()).pathname.slice('/maps/'.length);
  await expect
    .poll(() => readRecord(page, mapId))
    .toMatchObject({ map: { roots: [{ children: children.map(([, text]) => ({ text })) }] } });
  for (const opening of ['created', 'reopened']) {
    await expectInsideCanvas(nodes, 3);
    for (const [, title] of children) {
      const child = canvasAt(page).getByRole('button', { name: title, exact: true });
      await child.click();
      await expect(child).toHaveAttribute('aria-pressed', 'true');
    }
    await capture(page, `siblings-${opening}`);
    if (opening === 'created') await page.reload();
  }
});

const ROOT_ONLY: MindMap = { ...MAP, id: 'reveal', roots: [leaf('r')] };

for (const [key, direction, title] of [
  ['Tab', 'left', 'creation'],
  ['F2', 'right', 'title editing'],
] as const) {
  test(`minimally pans an off-screen ${title} target into view without zooming`, async ({
    page,
  }) => {
    await seedRecords(page, [envelopeOf(ROOT_ONLY)]);
    await page.goto('/maps/reveal');
    const root = nodeAt(page, 'r');
    await expectInsideCanvas(root, 1);
    await root.click();
    await page.mouse.move(600, 350);
    await page.mouse.wheel(0, 150);
    await expect.poll(async () => (await viewportOf(page)).zoom).toBeLessThan(1);
    const canvas = await panAcrossCanvas(page, direction);
    const clipped = await boxOf(page, 'r');
    if (direction === 'left') expect(clipped.x + clipped.width).toBeLessThan(canvas.x);
    else expect(clipped.x).toBeGreaterThan(canvas.x + canvas.width);
    const panned = await viewportOf(page);
    const origin = await root.evaluate((element) => element.style.transform);

    await page.keyboard.press(key);
    const input = page.getByRole('textbox', { name: '节点标题' });
    await expect(input).toBeFocused();
    const target = page.locator('.react-flow__node').filter({ has: input });
    await expectInsideCanvas(target, 1);
    const box = await target.boundingBox();
    if (box === null) throw new Error('missing editing target');
    // Touching the padded edge proves the correction stops as soon as the box fits.
    const margin =
      direction === 'left' ? box.x - canvas.x : canvas.x + canvas.width - box.x - box.width;
    expect(margin).toBeCloseTo(16, 1);
    expect(await viewportOf(page)).toMatchObject({ y: panned.y, zoom: panned.zoom });
    expect(await root.evaluate((element) => element.style.transform)).toBe(origin);
    await capture(page, `reveal-${key}`);
    await input.press('Escape');
    expect(await readRecord(page, ROOT_ONLY.id)).toStrictEqual(envelopeOf(ROOT_ONLY).value);
  });
}

test('editing a visible title preserves manual zoom and translation through commit', async ({
  page,
}) => {
  await seedRecords(page, [envelopeOf(ROOT_ONLY)]);
  await page.goto('/maps/reveal');
  const root = nodeAt(page, 'r');
  await expectInsideCanvas(root, 1);
  await root.click();
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 150);
  await expect.poll(async () => (await viewportOf(page)).zoom).toBeLessThan(1);
  const navigated = await viewportOf(page);
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: '节点标题' });
  await expect(input).toBeFocused();
  expect(await viewportOf(page)).toEqual(navigated);

  const text = '浏览缩放后，编辑可见的主题标题';
  await input.fill(text);
  await input.press('Enter');
  await expectInsideCanvas(root, 1);
  await expect
    .poll(() => readRecord(page, ROOT_ONLY.id))
    .toMatchObject({ map: { roots: [{ id: 'r', text, children: [] }] } });
  expect(await viewportOf(page)).toEqual(navigated);
  await capture(page, 'visible-title-edited');
});

test.describe('canvas-editing selection', () => {
  test.beforeEach(async ({ page }) => {
    await seedRecords(page, [RECORD]);
    await page.goto('/maps/selection');
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    for (const id of ['r', 'a', 'b', 'c', 'f', 'fc']) await expect(nodeAt(page, id)).toBeVisible();
    await expectInsideCanvas(page.locator('.react-flow__node'), 6);
  });

  test.afterEach(async ({ page }) => {
    await page.waitForTimeout(600);
    expect(await readRecord(page, RECORD.key)).toStrictEqual(RECORD.value);
  });

  test('manual fit reframes every root after panning away', async ({ page }) => {
    await nodeAt(page, 'r').click();
    await panAcrossCanvas(page, 'left');
    const before = await viewportOf(page);
    await page.getByRole('button', { name: '适应画布' }).click();
    await expectInsideCanvas(page.locator('.react-flow__node'), 6);
    expect(await viewportOf(page)).not.toEqual(before);
    await selected(page, ['r']);
    await capture(page, 'manual-fit');
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

  test('Space pan from header BODY focus preserves exact selection without a band', async ({
    page,
  }) => {
    await nodeAt(page, 'a').click();
    await nodeAt(page, 'b').click({ modifiers: ['Shift'] });
    await nodeAt(page, 'c').click({ modifiers: ['Shift'] });
    await selected(page, ['a', 'b', 'c']);
    await page.getByTestId('editor-title').click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    const before = await viewportOf(page);
    const pane = page.locator('.react-flow__pane');
    const box = await pane.boundingBox();
    if (box === null) throw new Error('missing pane');
    const start = { x: box.x + 30, y: box.y + box.height - 100 };
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'),
        start,
      ),
    ).toBe(true);
    await page.keyboard.down('Space');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y + 50, { steps: 12 });
    await expect
      .soft(
        page.getByRole('region', { name: '思维导图画布' }).locator(':scope > [aria-hidden="true"]'),
      )
      .toHaveCount(0);
    await page.mouse.up();
    await page.keyboard.up('Space');
    const after = await viewportOf(page);
    expect(after.x - before.x).toBeCloseTo(100);
    expect(after.y - before.y).toBeCloseTo(50);
    expect(after.zoom).toBe(before.zoom);
    await selected(page, ['a', 'b', 'c']);
    await capture(page, 'body-space-pan');
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

const DELETE_MAP: MindMap = {
  ...MAP,
  id: 'delete-selection',
  title: '删除选中主题',
  roots: [
    {
      id: 'r',
      text: '中心主题',
      children: [
        leaf('before'),
        { id: 'a', text: 'A', children: [leaf('aa'), leaf('ab')] },
        leaf('between'),
        { id: 'b', text: 'B', children: [leaf('ba')] },
        leaf('after'),
      ],
    },
    { id: 'g', text: 'G', position: { x: -200, y: 200 }, children: [] },
    { id: 'f', text: 'F', position: { x: 500, y: 300 }, children: [leaf('fa'), leaf('fb')] },
  ],
};

async function savedDeletionForest(page: Page, roots: MindMap['roots']) {
  await expect
    .poll(() => readRecord(page, DELETE_MAP.id))
    .toEqual({
      schemaVersion: 1,
      map: { ...DELETE_MAP, roots, updatedAt: expect.any(String) },
    });
}

test.describe('canvas-editing delete selection', () => {
  test.beforeEach(async ({ page }) => {
    await seedRecords(page, [envelopeOf(DELETE_MAP)]);
    await page.goto('/maps/delete-selection');
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(13);
    await expectInsideCanvas(page.locator('.react-flow__node'), 13);
  });

  test('Delete two selected subtrees', async ({ page }) => {
    await nodeAt(page, 'r').dblclick();
    await page.getByRole('textbox', { name: '节点标题' }).fill('保留的改名');
    await page.getByRole('textbox', { name: '节点标题' }).press('Enter');
    await nodeAt(page, 'a').click();
    await nodeAt(page, 'aa').click({ modifiers: ['Shift'] });
    await nodeAt(page, 'b').click({ modifiers: ['Shift'] });
    await selected(page, ['a', 'aa', 'b']);
    await page.keyboard.press('Delete');
    for (const id of ['a', 'aa', 'ab', 'b', 'ba']) await expect(nodeAt(page, id)).toHaveCount(0);
    await selected(page, []);
    const remaining = [
      { id: 'r', text: '保留的改名', children: [leaf('before'), leaf('between'), leaf('after')] },
      ...DELETE_MAP.roots.slice(1),
    ];
    await savedDeletionForest(page, remaining);
    await capture(page, 'delete-two-subtrees');
    await page.keyboard.press('ControlOrMeta+z');
    const renamed = DELETE_MAP.roots.map((root) =>
      root.id === 'r' ? { ...root, text: '保留的改名' } : root,
    );
    await savedDeletionForest(page, renamed);
    await expect(page.locator('.react-flow__node')).toHaveCount(13);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
    await capture(page, 'delete-two-subtrees-undo');
    await page.keyboard.press('ControlOrMeta+z');
    await savedDeletionForest(page, DELETE_MAP.roots);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  });

  test('Primary root in selection', async ({ page }) => {
    await nodeAt(page, 'r').click();
    await nodeAt(page, 'aa').click({ modifiers: ['Shift'] });
    await nodeAt(page, 'f').click({ modifiers: ['Shift'] });
    await page.keyboard.press('Delete');
    await expect(nodeAt(page, 'aa')).toHaveCount(0);
    await expect(nodeAt(page, 'f')).toHaveCount(0);
    await expect(nodeAt(page, 'fa')).toHaveCount(0);
    await expect(nodeAt(page, 'fb')).toHaveCount(0);
    await selected(page, ['r']);
    await expect(page.getByRole('alert').filter({ hasText: '主根不能删除' })).toBeVisible();
    await savedDeletionForest(page, [
      {
        id: 'r',
        text: '中心主题',
        children: [
          leaf('before'),
          { id: 'a', text: 'A', children: [leaf('ab')] },
          leaf('between'),
          { id: 'b', text: 'B', children: [leaf('ba')] },
          leaf('after'),
        ],
      },
      { id: 'g', text: 'G', position: { x: -200, y: 200 }, children: [] },
    ]);
    await capture(page, 'delete-primary-selection');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '主根不能删除' })).toHaveCount(0);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await savedDeletionForest(page, DELETE_MAP.roots);
    await expect(page.locator('.react-flow__node')).toHaveCount(13);
  });

  test('Select all then Delete', async ({ page }) => {
    const floatingPosition = await nodeAt(page, 'f').evaluate((element) => element.style.transform);
    await nodeAt(page, 'r').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    await selected(page, ['r']);
    await expect(page.getByRole('alert').filter({ hasText: '主根不能删除' })).toBeVisible();
    await savedDeletionForest(page, [{ id: 'r', text: '中心主题', children: [] }]);
    await capture(page, 'delete-select-all');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.react-flow__node')).toHaveCount(13);
    await savedDeletionForest(page, DELETE_MAP.roots);
    await expect
      .poll(() => nodeAt(page, 'f').evaluate((element) => element.style.transform))
      .toBe(floatingPosition);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await capture(page, 'delete-select-all-undo');
  });

  test('Delete a floating root from the canvas', async ({ page }) => {
    const floatingPosition = await nodeAt(page, 'f').evaluate((element) => element.style.transform);
    await nodeAt(page, 'f').click();
    await page.keyboard.press('Delete');
    for (const id of ['f', 'fa', 'fb']) await expect(nodeAt(page, id)).toHaveCount(0);
    await savedDeletionForest(page, DELETE_MAP.roots.slice(0, 2));
    await capture(page, 'delete-floating-root');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(nodeAt(page, 'fa')).toBeVisible();
    await expect(nodeAt(page, 'fb')).toBeVisible();
    await savedDeletionForest(page, DELETE_MAP.roots);
    await expect
      .poll(() => nodeAt(page, 'f').evaluate((element) => element.style.transform))
      .toBe(floatingPosition);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await capture(page, 'delete-floating-root-undo');
  });

  test('Delete inside the editor', async ({ page }) => {
    await nodeAt(page, 'a').dblclick();
    const input = page.getByRole('textbox', { name: '节点标题' });
    await input.press('End');
    await input.pressSequentially('xy');
    await expect(input).toHaveValue('Axy');
    await input.press('Backspace');
    await expect(input).toHaveValue('Ax');
    await input.press('Home');
    await input.press('Delete');
    await expect(input).toHaveValue('x');
    await expect(input).toBeFocused();
    await expect(page.locator('.react-flow__node')).toHaveCount(13);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled();
    expect(await readRecord(page, DELETE_MAP.id)).toStrictEqual(envelopeOf(DELETE_MAP).value);
    await capture(page, 'delete-native-text');
    await input.press('Escape');
    await expect(nodeAt(page, 'a')).toHaveText('A');
  });
});
