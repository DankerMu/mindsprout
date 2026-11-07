import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { envelopeOf, readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
const NOW = '2026-11-06T12:34:56.789Z';
const EARLY = '2026-11-05T10:00:00.000Z';
const LATE = '2026-11-05T11:00:00.000Z';
fs.mkdirSync(EVIDENCE, { recursive: true });

const TARGET = {
  id: 'A',
  title: 'A',
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
  title: 'B',
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

test.describe('map-library', () => {
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
    await expect(rows.locator('time')).toHaveText([LATE, EARLY]);
    await expect(rows.nth(0).locator('time')).toHaveAttribute('datetime', LATE);
    await expect(rows.nth(1).locator('time')).toHaveAttribute('datetime', EARLY);
    await expect(rows.nth(0).locator('time')).toBeVisible();
    await expect(rows.nth(1).locator('time')).toBeVisible();
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

  test('Rename from the list', async ({ page }) => {
    const noise = watchConsole(page);
    await page.clock.setFixedTime(new Date(NOW));
    await seedRecords(page, [envelopeOf(TARGET), envelopeOf(PEER)]);
    await page.goto('/');
    await expect(page.getByRole('listitem').getByRole('link')).toHaveText(['B', 'A']);
    await page.getByRole('button', { name: '重命名 A', exact: true }).click();
    const title = page.getByRole('textbox', { name: '标题', exact: true });
    await expect(title).toBeFocused();
    await title.fill('读书笔记');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('listitem').getByRole('link')).toHaveText(['读书笔记', 'B']);
    await expect(page.getByRole('listitem').locator('time')).toHaveText([NOW, LATE]);
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

  test('Delete with confirmation', async ({ page }) => {
    const noise = watchConsole(page);
    await seedRecords(page, [envelopeOf(TARGET), envelopeOf(PEER)]);
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '删除 A', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '删除 A', exact: true });
    await expect(dialog).toContainText('确定永久删除“A”吗？');
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL('/');
    expect(await readRecord(page, 'A')).toStrictEqual(envelopeOf(TARGET).value);
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await expect(page.getByRole('listitem').getByRole('link')).toHaveText(['B', 'A']);

    await trigger.click();
    await page.screenshot({
      path: `${EVIDENCE}/map-library-delete-confirmation.png`,
      fullPage: true,
    });
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('listitem').getByRole('link')).toHaveText(['B']);
    await expect(page.getByRole('button', { name: '新建导图' })).toBeFocused();
    expect(await readRecord(page, 'A')).toBeUndefined();
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await page.screenshot({ path: `${EVIDENCE}/map-library-deleted.png`, fullPage: true });

    await page.goto('/maps/A');
    await expect(page.getByText('找不到这张导图', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '返回导图列表' })).toHaveAttribute('href', '/');
    await page.screenshot({
      path: `${EVIDENCE}/map-library-deleted-not-found.png`,
      fullPage: true,
    });
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    expect(noise).toEqual([]);
  });

  test('Future-version rename is refused and explicit deletion removes the raw record', async ({
    page,
  }) => {
    const noise = watchConsole(page);
    const future = {
      key: 'future',
      value: {
        schemaVersion: 2,
        map: { title: 'Future', updatedAt: EARLY, roots: 'future tree shape' },
      },
    };
    await seedRecords(page, [future, envelopeOf(PEER)]);
    await page.goto('/');
    await page.getByRole('button', { name: '重命名 Future', exact: true }).click();
    await page.getByRole('textbox', { name: '标题', exact: true }).fill('不得保存');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('form', { name: '重命名 Future' }).getByRole('alert')).toHaveText(
      '此导图由更新版本创建',
    );
    await expect(page.getByRole('link', { name: 'Future', exact: true })).toBeVisible();
    expect(await readRecord(page, future.key)).toStrictEqual(future.value);
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await page.screenshot({
      path: `${EVIDENCE}/map-library-future-rename-refused.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '删除 Future', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '删除 Future', exact: true });
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByRole('listitem').getByRole('link')).toHaveText(['B']);
    expect(await readRecord(page, future.key)).toBeUndefined();
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await page.screenshot({ path: `${EVIDENCE}/map-library-future-deleted.png`, fullPage: true });
    expect(noise).toEqual([]);
  });

  for (const version of ['1', 0]) {
    test(`Odd-version ${JSON.stringify(version)} deletion does not interpret its content`, async ({
      page,
    }) => {
      const noise = watchConsole(page);
      const odd = {
        key: 'odd',
        value: { schemaVersion: version, map: { title: 'Odd', updatedAt: EARLY } },
      };
      const hidden = { key: 'hidden', value: { schemaVersion: version, map: { title: 42 } } };
      await seedRecords(page, [odd, hidden, envelopeOf(PEER)]);
      await page.goto('/');
      await expect(page.getByRole('listitem').getByRole('link')).toHaveText(['B', 'Odd']);
      await page.getByRole('button', { name: '删除 Odd', exact: true }).click();
      await page
        .getByRole('dialog', { name: '删除 Odd' })
        .getByRole('button', { name: '确认删除' })
        .click();
      await expect(page.getByRole('listitem').getByRole('link')).toHaveText(['B']);
      expect(await readRecord(page, odd.key)).toBeUndefined();
      expect(await readRecord(page, hidden.key)).toStrictEqual(hidden.value);
      expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
      await page.screenshot({
        path: `${EVIDENCE}/map-library-odd-${String(version)}-deleted.png`,
        fullPage: true,
      });
      expect(noise).toEqual([]);
    });
  }

  test('Rename refuses a mismatched embedded ID without overwriting its peer', async ({ page }) => {
    const noise = watchConsole(page);
    const mismatched = {
      key: 'selected',
      value: { schemaVersion: 1, map: { ...PEER, title: 'Mismatched' } },
    };
    await seedRecords(page, [mismatched, envelopeOf(PEER)]);
    await page.goto('/');
    await page.getByRole('button', { name: '重命名 Mismatched' }).click();
    await page.getByRole('textbox', { name: '标题', exact: true }).fill('不得覆盖');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(
      page.getByRole('form', { name: '重命名 Mismatched' }).getByRole('alert'),
    ).toHaveText('保存失败，请重试');
    expect(await readRecord(page, 'selected')).toStrictEqual(mismatched.value);
    expect(await readRecord(page, 'B')).toStrictEqual(envelopeOf(PEER).value);
    await page.screenshot({
      path: `${EVIDENCE}/map-library-mismatched-rename-refused.png`,
      fullPage: true,
    });
    expect(noise).toEqual([]);
  });
});
