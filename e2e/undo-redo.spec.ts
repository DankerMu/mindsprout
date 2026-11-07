import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { envelopeOf, readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });
const MAP = {
  id: 'undo-redo',
  title: '撤销与重做',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [{ id: 'r', text: '中心主题', children: [{ id: 'a', text: 'A', children: [] }] }],
};
const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inputAt = (page: Page) => page.getByRole('textbox', { name: '节点标题' });
const undo = (page: Page) => page.getByRole('button', { name: '撤销', exact: true });
const redo = (page: Page) => page.getByRole('button', { name: '重做', exact: true });

async function create(page: Page, text?: string) {
  await nodeAt(page, 'r').click();
  await page.keyboard.press('Tab');
  await expect(inputAt(page)).toBeFocused();
  const id = await page.locator('.react-flow__node.selected').getAttribute('data-id');
  if (id === null) throw new Error('created node has no id');
  if (text !== undefined) {
    await inputAt(page).pressSequentially(text);
    await inputAt(page).press('Enter');
  }
  return id;
}

async function rename(page: Page) {
  await nodeAt(page, 'a').dblclick();
  await inputAt(page).pressSequentially('B');
  await inputAt(page).press('Enter');
  await expect(nodeAt(page, 'a')).toHaveText('B');
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: `${EVIDENCE}/undo-redo-${name}.png` });
}

test.describe('canvas history affordances', () => {
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
    await page.goto('/maps/undo-redo');
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expect(nodeAt(page, 'a')).toBeVisible();
    await page.getByRole('button', { name: '适应画布' }).click();
  });
  test.afterEach(() => {
    expect(noise).toEqual([]);
  });

  test('Undo a Tab-created child with Cmd/Ctrl+Z', async ({ page }) => {
    const id = await create(page, '想法');
    await expect(nodeAt(page, id)).toHaveText('想法');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(nodeAt(page, id)).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeEnabled();
    await capture(page, 'shortcut-undo');
  });

  test('Redo with Cmd/Ctrl+Shift+Z', async ({ page }) => {
    const id = await create(page, '想法');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(nodeAt(page, id)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(nodeAt(page, id)).toHaveText('想法');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(undo(page)).toBeEnabled();
    await expect(redo(page)).toBeDisabled();
    await capture(page, 'shortcut-redo');
  });

  test('Buttons reflect availability', async ({ page }) => {
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    const id = await create(page, '想法');
    await expect(undo(page)).toBeEnabled();
    await expect(redo(page)).toBeDisabled();
    await undo(page).click();
    await expect(nodeAt(page, id)).toHaveCount(0);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeEnabled();
    await redo(page).click();
    await expect(nodeAt(page, id)).toHaveText('想法');
    await expect(undo(page)).toBeEnabled();
    await expect(redo(page)).toBeDisabled();
    await capture(page, 'buttons');
  });

  test('Undo inside the editor', async ({ page }) => {
    const id = await create(page, '想法');
    await nodeAt(page, 'a').dblclick();
    await inputAt(page).press('End');
    await inputAt(page).pressSequentially(' typed draft');
    await expect(inputAt(page)).toHaveValue('A typed draft');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(inputAt(page)).toHaveValue('A');
    await expect(inputAt(page)).toBeFocused();
    await expect(nodeAt(page, id)).toHaveText('想法');
    await expect(undo(page)).toBeEnabled();
    await expect(redo(page)).toBeDisabled();
    await expect
      .poll(() => readRecord(page, MAP.id))
      .toMatchObject({
        map: {
          roots: [
            {
              children: [
                { id: 'a', text: 'A' },
                { id, text: '想法' },
              ],
            },
          ],
        },
      });
    await capture(page, 'native-text-undo');
    await inputAt(page).press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(nodeAt(page, id)).toHaveCount(0);
  });

  test('Reload clears history', async ({ page }) => {
    const id = await create(page, '保留的想法');
    const roots = [
      {
        id: 'r',
        text: '中心主题',
        children: [
          { id: 'a', text: 'A', children: [] },
          { id, text: '保留的想法', children: [] },
        ],
      },
    ];
    await expect.poll(() => readRecord(page, MAP.id)).toMatchObject({ map: { roots } });
    const saved = await readRecord(page, MAP.id);
    await page.reload();
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expect(nodeAt(page, id)).toHaveText('保留的想法');
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    await page.getByRole('region').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(nodeAt(page, id)).toHaveText('保留的想法');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    expect(await readRecord(page, MAP.id)).toEqual(saved);
    await capture(page, 'reload');
  });

  for (const label of ['撤销', '重做']) {
    test(`Empty-create ${label} preserves prior history and the second click acts`, async ({
      page,
    }) => {
      await rename(page);
      if (label === '重做') await undo(page).click();
      const id = await create(page);
      const button = page.getByRole('button', { name: label, exact: true });
      await expect(button).toBeEnabled();
      await button.click();
      await expect(inputAt(page)).toHaveCount(0);
      await expect(nodeAt(page, id)).toHaveCount(0);
      await expect(nodeAt(page, 'a')).toHaveText(label === '撤销' ? 'B' : 'A');
      await expect(button).toBeEnabled();
      await capture(page, label === '撤销' ? 'empty-undo-protected' : 'empty-redo-protected');
      await button.click();
      await expect(nodeAt(page, 'a')).toHaveText(label === '撤销' ? 'A' : 'B');
      await expect(button).toBeDisabled();
    });
  }

  test('Cancelled mouse gesture leaves keyboard activation live', async ({ page }) => {
    await rename(page);
    const id = await create(page);
    await undo(page).hover();
    await page.mouse.down();
    await expect(inputAt(page)).toHaveCount(0);
    await page.mouse.move(10, 10);
    await page.mouse.up();
    await expect(nodeAt(page, id)).toHaveCount(0);
    await expect(nodeAt(page, 'a')).toHaveText('B');
    await undo(page).focus();
    await page.keyboard.press('Enter');
    await expect(nodeAt(page, 'a')).toHaveText('A');
    await redo(page).focus();
    await page.keyboard.press('Space');
    await expect(nodeAt(page, 'a')).toHaveText('B');
    await capture(page, 'cancelled-pointer-keyboard');
  });
});
