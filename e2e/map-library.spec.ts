import { expect, type Page } from '@playwright/test';
import { test } from './support/session';
import * as fs from 'node:fs';
import { envelopeOf, readRecord, seedRecords } from './support/seed';
import { collectExpectedResponses } from './support/expected-responses';

const EVIDENCE = '.run/ui-evidence';
const NOW = '2026-11-06T12:34:56.789Z';
const EARLY = '2026-11-05T00:30:00.000Z';
const LATE = '2026-11-05T01:30:00.000Z';
fs.mkdirSync(EVIDENCE, { recursive: true });

const TARGET = {
  id: 'A',
  title: '新导图',
  createdAt: EARLY,
  updatedAt: EARLY,
  roots: [
    {
      id: 'a-root',
      text: '独立的根标题',
      note: '保留备注',
      color: 'blue',
      children: [{ id: 'a-child', text: '子节点', children: [] }],
    },
    {
      id: 'a-floating',
      text: '浮动主题',
      position: { x: 300, y: 200 },
      collapsed: true,
      children: [{ id: 'a-hidden', text: '折叠的子节点', children: [] }],
    },
  ],
};
const PEER = {
  ...TARGET,
  id: 'B',
  updatedAt: LATE,
  roots: [{ id: 'b-root', text: '另一张导图的根', children: [] }],
};

function watchConsole(page: Page): string[] {
  const noise: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      noise.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    noise.push(`pageerror: ${String(error)}`);
  });
  return noise;
}

function watchDocuments(page: Page): string[] {
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url());
  });
  return documents;
}

async function openSameTitleRows(page: Page) {
  await seedRecords(page, [envelopeOf(TARGET), envelopeOf(PEER)]);
  await page.goto('/');
  const rows = page.getByRole('listitem');
  const peer = rows.nth(0);
  const target = rows.nth(1);
  await expect(rows.getByRole('link')).toHaveText(['新导图', '新导图']);
  await expect(peer.getByRole('link')).toHaveAttribute('href', '/maps/B');
  await expect(target.getByRole('link')).toHaveAttribute('href', '/maps/A');
  return { rows, target };
}

test.describe('map-library', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('Create from the empty state', async ({ page }) => {
    const noise = watchConsole(page);
    await page.clock.setFixedTime(new Date(NOW));
    await seedRecords(page, []);
    await page.goto('/');
    await expect(page.getByTestId('app-ready')).toBeVisible();
    await expect(page.getByText('还没有导图')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/map-library-empty.png`, fullPage: true });
    const documents = watchDocuments(page);

    await page.getByRole('button', { name: '新建导图' }).click();
    await expect(page).toHaveURL(/\/maps\/[^/]+$/);
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expect(page.getByTestId('editor-title')).toHaveText('新导图');
    const root = page.locator('.react-flow__node');
    await expect(root).toHaveCount(1);
    await expect(root).toHaveText('新导图');
    await expect(root).toBeVisible();
    const id = new URL(page.url()).pathname.slice('/maps/'.length);
    const rootId = await root.getAttribute('data-id');
    expect(rootId).not.toBe(id);
    expect(await readRecord(page, id)).toStrictEqual({
      schemaVersion: 1,
      map: {
        id,
        title: '新导图',
        createdAt: NOW,
        updatedAt: NOW,
        roots: [{ id: rootId, text: '新导图', children: [] }],
      },
    });
    expect(documents).toEqual([]);
    await page.screenshot({ path: `${EVIDENCE}/map-library-created.png`, fullPage: true });
    expect(noise).toEqual([]);
  });

  test('Ordering', async ({ page }) => {
    const noise = watchConsole(page);
    const a = {
      id: 'A',
      title: 'A',
      createdAt: EARLY,
      updatedAt: EARLY,
      roots: [{ id: 'a-root', text: 'A root', children: [] }],
    };
    const b = {
      id: 'B',
      title: 'B',
      createdAt: EARLY,
      updatedAt: LATE,
      roots: [{ id: 'b-root', text: 'B root', children: [] }],
    };
    await seedRecords(page, [envelopeOf(a), envelopeOf(b)]);
    await page.goto('/');
    await expect(page.getByTestId('app-ready')).toBeVisible();
    const rows = page.getByRole('listitem');
    await expect(rows.getByRole('link')).toHaveText(['B', 'A']);
    await expect(rows.locator('time')).toHaveText(['2026年11月4日 17:30', '2026年11月4日 16:30']);
    await expect(rows.nth(0).locator('time')).toHaveAttribute('datetime', LATE);
    await expect(rows.nth(1).locator('time')).toHaveAttribute('datetime', EARLY);
    await expect(rows.nth(0).locator('time')).toBeVisible();
    await expect(rows.nth(1).locator('time')).toBeVisible();
    const firstRow = rows.nth(0);
    const rename = firstRow.getByRole('button', { name: '重命名 B', exact: true });
    await Promise.all([
      expect.soft(page.getByRole('list')).toHaveAttribute('role', 'list'),
      expect.soft(page.getByRole('list')).toHaveCSS('list-style-type', 'none'),
      expect.soft(firstRow).toHaveCSS('display', 'flex'),
      expect.soft(firstRow).toHaveCSS('flex-wrap', 'wrap'),
      expect.soft(rename).toHaveCSS('border-top-left-radius', '6px'),
      expect.soft(rename).toHaveCSS('border-top-color', 'rgb(208, 215, 222)'),
    ]);
    await page.screenshot({ path: `${EVIDENCE}/map-library-ordering.png`, fullPage: true });
    const documents = watchDocuments(page);

    await page.getByRole('link', { name: 'A', exact: true }).click();
    await expect(page).toHaveURL(/\/maps\/A$/);
    await expect(page.getByTestId('editor-title')).toHaveText('A');
    await expect(page.locator('.react-flow__node')).toHaveText('A root');
    expect(await readRecord(page, 'A')).toStrictEqual(envelopeOf(a).value);
    expect(documents).toEqual([]);
    await page.screenshot({ path: `${EVIDENCE}/map-library-open-a.png`, fullPage: true });
    expect(noise).toEqual([]);
  });

  test('Rename the second of two same-title maps', async ({ page }) => {
    const noise = watchConsole(page);
    await page.clock.setFixedTime(new Date(NOW));
    const { rows, target } = await openSameTitleRows(page);
    const trigger = target.getByRole('button', { name: '重命名 新导图', exact: true });
    const form = target.getByRole('form', { name: '重命名 新导图', exact: true });
    await trigger.click();
    await expect(form).toBeVisible();
    await expect(form).toHaveCSS('display', 'flex');
    await expect(page.getByRole('form')).toHaveCount(1);
    const title = form.getByRole('textbox', { name: '标题', exact: true });
    await expect(title).toBeFocused();
    await page.screenshot({
      path: `${EVIDENCE}/map-library-same-title-rename.png`,
      fullPage: true,
    });
    await title.fill('取消的标题草稿');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('form')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL('/');
    expect(await readRecord(page, 'A')).toStrictEqual(envelopeOf(TARGET).value);
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await page.screenshot({
      path: `${EVIDENCE}/map-library-rename-escape-cancelled.png`,
      fullPage: true,
    });
    await trigger.click();
    await expect(title).toBeFocused();
    await title.fill('读书笔记');
    await form.getByRole('button', { name: '保存', exact: true }).click();
    await expect(rows.getByRole('link')).toHaveText(['读书笔记', '新导图']);
    await expect(rows.locator('time')).toHaveText(['2026年11月6日 04:34', '2026年11月4日 17:30']);
    await expect(rows.nth(0).locator('time')).toHaveAttribute('datetime', NOW);
    await expect(rows.nth(1).locator('time')).toHaveAttribute('datetime', LATE);
    await expect(page.getByRole('button', { name: '重命名 读书笔记' })).toBeFocused();
    const renamedMap = { ...TARGET, title: '读书笔记', updatedAt: NOW };
    const expected = envelopeOf(renamedMap).value;
    expect(await readRecord(page, 'A')).toStrictEqual(expected);
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await page.screenshot({ path: `${EVIDENCE}/map-library-renamed.png`, fullPage: true });

    await page.getByRole('link', { name: '读书笔记', exact: true }).click();
    await expect(page).toHaveURL('/maps/A');
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expect(page.getByTestId('editor-title')).toHaveText('读书笔记');
    await expect(page.getByRole('button', { name: '独立的根标题', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '子节点', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '浮动主题', exact: true })).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled();
    await page.screenshot({ path: `${EVIDENCE}/map-library-renamed-editor.png`, fullPage: true });
    expect(await readRecord(page, 'A')).toStrictEqual(expected);
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    expect(noise).toEqual([]);
  });

  test('Delete the second of two same-title maps', async ({ page }) => {
    const noise = watchConsole(page);
    const { rows, target } = await openSameTitleRows(page);
    const trigger = target.getByRole('button', { name: '删除 新导图', exact: true });
    const dialog = target.getByRole('dialog', { name: '删除 新导图', exact: true });
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('position', 'static');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(dialog.getByText('确定永久删除“新导图”吗？', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL('/');
    expect(await readRecord(page, 'A')).toStrictEqual(envelopeOf(TARGET).value);
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await page.screenshot({
      path: `${EVIDENCE}/map-library-delete-escape-cancelled.png`,
      fullPage: true,
    });
    await trigger.click();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL('/');
    expect(await readRecord(page, 'A')).toStrictEqual(envelopeOf(TARGET).value);
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await expect(rows.getByRole('link')).toHaveText(['新导图', '新导图']);

    await trigger.click();
    await page.screenshot({
      path: `${EVIDENCE}/map-library-delete-confirmation.png`,
      fullPage: true,
    });
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rows.getByRole('link')).toHaveText(['新导图']);
    await expect(rows.getByRole('link')).toHaveAttribute('href', '/maps/B');
    await expect(page.getByRole('button', { name: '新建导图' })).toBeFocused();
    expect(await readRecord(page, 'A')).toBeUndefined();
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await page.screenshot({ path: `${EVIDENCE}/map-library-deleted.png`, fullPage: true });
    expect(noise).toEqual([]);

    const expected = collectExpectedResponses(page, [{ url: '/api/maps/A', status: 404 }]);
    await page.goto('/maps/A');
    await expect(page.getByText('找不到这张导图', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '返回导图列表' })).toHaveAttribute('href', '/');
    await page.screenshot({
      path: `${EVIDENCE}/map-library-deleted-not-found.png`,
      fullPage: true,
    });
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    expect(await expected.noise()).toEqual([]);
  });
});
