import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { envelopeOf, readRecord, seedRecords } from './support/seed';
import { edgeGeometry, expectEdgesOnHandles } from './support/canvas-geometry';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });
const MAP = {
  id: 'node-creation',
  title: '创建节点',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [
    {
      id: 'r',
      text: '中心主题',
      children: [
        { id: 'a', text: '主题甲', children: [] },
        {
          id: 'b',
          text: '折叠主题',
          collapsed: true,
          children: [
            { id: 'h1', text: '隐藏一', children: [] },
            { id: 'h2', text: '隐藏二', children: [] },
          ],
        },
        { id: 'c', text: '主题丙', children: [] },
      ],
    },
    { id: 'f', text: '浮动主题', position: { x: 500, y: 200 }, children: [] },
  ],
};
const RECORD = envelopeOf(MAP);
const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inputAt = (page: Page) => page.getByRole('textbox', { name: '节点标题' });

async function createFrom(page: Page, id: string, key = 'Tab') {
  await nodeAt(page, id).click();
  await page.keyboard.press(key);
  await expect(inputAt(page)).toBeFocused();
  await expect(inputAt(page)).toHaveValue('');
  const selected = page.locator('.react-flow__node.selected');
  await expect(selected).toHaveCount(1);
  await expect(selected.getByRole('textbox')).toBeFocused();
  const created = await selected.getAttribute('data-id');
  if (created === null) throw new Error('created node has no id');
  return created;
}

async function nameNode(page: Page, text: string) {
  await inputAt(page).fill(text);
  await inputAt(page).press('Enter');
  await expect(inputAt(page)).toHaveCount(0);
  await expect(page.getByRole('region')).toBeFocused();
}

async function expectChild(page: Page, parent: string, child: string) {
  await expect(async () => {
    const geometry = await edgeGeometry(page, [{ source: parent, target: child }]);
    for (const edge of geometry) expectEdgesOnHandles(edge);
  }).toPass();
}

async function expectOrder(page: Page, ids: string[]) {
  const positions = [];
  for (const id of ids) {
    const box = await nodeAt(page, id).boundingBox();
    if (box === null) throw new Error(`missing visible node ${id}`);
    positions.push(box.y);
  }
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(new Set(positions).size).toBe(ids.length);
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: `${EVIDENCE}/node-creation-${name}.png` });
}

async function expectSavedBaseline(page: Page) {
  expect(await readRecord(page, MAP.id)).toMatchObject({
    schemaVersion: 1,
    map: { id: MAP.id, title: MAP.title, createdAt: MAP.createdAt, roots: MAP.roots },
  });
}

test.describe('keyboard node creation', () => {
  let noise: string[];
  test.beforeEach(async ({ page }) => {
    noise = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') noise.push(message.text());
    });
    page.on('pageerror', (error) => {
      noise.push(String(error));
    });
    await seedRecords(page, [RECORD]);
    await page.goto('/maps/node-creation');
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    for (const id of ['r', 'a', 'b', 'c', 'f']) await expect(nodeAt(page, id)).toBeVisible();
    await page.getByRole('button', { name: '适应画布' }).click();
  });
  test.afterEach(() => {
    expect(noise).toEqual([]);
  });

  test('Tab adds a child', async ({ page }) => {
    const id = await createFrom(page, 'r');
    await expectChild(page, 'r', id);
    await expectOrder(page, ['a', 'b', 'c', id]);
    await capture(page, 'tab-focused');
    await nameNode(page, '最后一个孩子');
    await expect(nodeAt(page, id)).toHaveText('最后一个孩子');
  });

  test('Tab on a collapsed node — naming then undo restores the collapsed parent', async ({
    page,
  }) => {
    const id = await createFrom(page, 'b');
    await expect(nodeAt(page, 'h1')).toBeVisible();
    await expect(nodeAt(page, 'h2')).toBeVisible();
    await expectChild(page, 'b', id);
    await expectOrder(page, ['h1', 'h2', id]);
    await capture(page, 'collapsed-focused');
    await nameNode(page, '第三个孩子');
    await expect(nodeAt(page, id)).toHaveText('第三个孩子');
    await capture(page, 'collapsed-named');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(nodeAt(page, id)).toHaveCount(0);
    await expect(nodeAt(page, 'h1')).toHaveCount(0);
    await expect(nodeAt(page, 'h2')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await expect.poll(() => readRecord(page, MAP.id)).toMatchObject({ map: { roots: MAP.roots } });
    await capture(page, 'collapsed-undone');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(nodeAt(page, id)).toHaveText('第三个孩子');
    await expect(nodeAt(page, 'h1')).toHaveText('隐藏一');
    await expect(nodeAt(page, 'h2')).toHaveText('隐藏二');
    await expectOrder(page, ['h1', 'h2', id]);
  });

  test('Enter on the primary root', async ({ page }) => {
    const id = await createFrom(page, 'r', 'Enter');
    await nameNode(page, '主根的孩子');
    await expectChild(page, 'r', id);
    await expectOrder(page, ['a', 'b', 'c', id]);
    await capture(page, 'primary-root');
  });

  test('Enter on a floating root', async ({ page }) => {
    const position = await nodeAt(page, 'f').evaluate((node) => node.style.transform);
    const id = await createFrom(page, 'f', 'Enter');
    await nameNode(page, '浮动根的孩子');
    await expectChild(page, 'f', id);
    expect(await nodeAt(page, 'f').evaluate((node) => node.style.transform)).toBe(position);
    await page.waitForTimeout(600);
    expect(await readRecord(page, MAP.id)).toMatchObject({
      map: {
        roots: [
          { id: 'r' },
          { id: 'f', position: { x: 500, y: 200 }, children: [{ id, text: '浮动根的孩子' }] },
        ],
      },
    });
    await capture(page, 'floating-root');
  });

  test('Name a new node — one shortcut undoes creation and naming', async ({ page }) => {
    const id = await createFrom(page, 'a');
    await nameNode(page, '想法');
    await expect(nodeAt(page, id)).toHaveText('想法');
    await expectChild(page, 'a', id);
    await expect(page.locator('.react-flow__node')).toHaveCount(6);
    await capture(page, 'named');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(nodeAt(page, id)).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled();
    await capture(page, 'named-undone');
  });

  test('Empty new node is discarded', async ({ page }) => {
    const id = await createFrom(page, 'b');
    await inputAt(page).press('Enter');
    await expect(nodeAt(page, id)).toHaveCount(0);
    await expect(inputAt(page)).toHaveCount(0);
    await expect(nodeAt(page, 'b')).toHaveClass(/selected/);
    await expect(nodeAt(page, 'h1')).toHaveCount(0);
    await expect(nodeAt(page, 'h2')).toHaveCount(0);
    await page.waitForTimeout(600);
    await expectSavedBaseline(page);
    await capture(page, 'empty');
  });

  test('Enter inserts the next sibling after the middle node', async ({ page }) => {
    const id = await createFrom(page, 'b', 'Enter');
    await nameNode(page, '中间的兄弟');
    await expectChild(page, 'r', id);
    await expectOrder(page, ['a', 'b', id, 'c']);
    await page.waitForTimeout(600);
    expect(await readRecord(page, MAP.id)).toMatchObject({
      map: {
        roots: [
          {
            id: 'r',
            children: [{ id: 'a' }, { id: 'b' }, { id, text: '中间的兄弟' }, { id: 'c' }],
          },
          { id: 'f' },
        ],
      },
    });
    await capture(page, 'sibling');
  });

  test('Escape cancels creation and restores the collapsed parent', async ({ page }) => {
    const id = await createFrom(page, 'b');
    await inputAt(page).fill('不保存');
    await inputAt(page).press('Escape');
    await expect(inputAt(page)).toHaveCount(0);
    await expect(nodeAt(page, id)).toHaveCount(0);
    await expect(nodeAt(page, 'b')).toHaveClass(/selected/);
    await expect(nodeAt(page, 'h1')).toHaveCount(0);
    await expect(nodeAt(page, 'h2')).toHaveCount(0);
    await expect(page.getByRole('region')).toBeFocused();
    await page.waitForTimeout(600);
    await expectSavedBaseline(page);
    await capture(page, 'escape');
  });

  test('Reload after edits', async ({ page }) => {
    const first = await createFrom(page, 'a');
    await nameNode(page, '第一想法');
    const second = await createFrom(page, first, 'Enter');
    await nameNode(page, '第二想法');
    const third = await createFrom(page, second);
    await nameNode(page, '第三想法');
    await page.waitForTimeout(1000);
    const expected = {
      map: {
        roots: [
          {
            id: 'r',
            children: [
              {
                id: 'a',
                children: [
                  { id: first, text: '第一想法', children: [] },
                  {
                    id: second,
                    text: '第二想法',
                    children: [{ id: third, text: '第三想法', children: [] }],
                  },
                ],
              },
              { id: 'b' },
              { id: 'c' },
            ],
          },
          { id: 'f', position: { x: 500, y: 200 } },
        ],
      },
    };
    const saved = await readRecord(page, MAP.id);
    expect(saved).toMatchObject(expected);
    await page.reload();
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    for (const [id, text] of [
      [first, '第一想法'],
      [second, '第二想法'],
      [third, '第三想法'],
    ] as const) {
      await expect(nodeAt(page, id)).toHaveText(text);
    }
    await expectChild(page, 'a', first);
    await expectChild(page, 'a', second);
    await expectChild(page, second, third);
    await expectOrder(page, [first, second]);
    expect(await readRecord(page, MAP.id)).toEqual(saved);
    await capture(page, 'reload');
  });
});
