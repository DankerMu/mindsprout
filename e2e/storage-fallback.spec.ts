import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import { MAP_STORE } from '../src/contexts/map/infrastructure/persistence/indexed-db-map-repository';
import { envelopeOf, readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });

test.describe('storage fallback', () => {
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

  test('Private mode retains inline edits across SPA reopen, but not a full reload', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      IDBFactory.prototype.open = () => {
        throw new DOMException('Private mode', 'SecurityError');
      };
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: '新建导图' })).toBeEnabled();
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents.push(request.url());
    });
    await page.getByRole('button', { name: '新建导图' }).click();
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    const editorUrl = page.url();
    const root = page.locator('.react-flow__node');
    await expect(root).toBeVisible();
    await expect(page.getByText('未保存到浏览器', { exact: true })).toHaveCount(1);
    await page.clock.install();
    await root.dblclick();
    const input = page.getByRole('textbox', { name: '节点标题' });
    await input.fill('仅保存在本次会话');
    await input.press('Enter');
    // Cross the specified 500 ms save window before inspecting or leaving the editor.
    await page.clock.runFor(600);
    await expect(root).toHaveText('仅保存在本次会话');
    await expect(root).toBeVisible();
    await expect(page.getByText('未保存到浏览器', { exact: true })).toBeVisible();
    await expect(page.getByText('保存失败', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/storage-private-renamed.png` });

    await page.goBack();
    await expect(page.getByTestId('app-ready')).toBeVisible();
    await page.getByRole('link', { name: '新导图', exact: true }).click();
    await expect(page).toHaveURL(editorUrl);
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expect(root).toHaveText('仅保存在本次会话');
    await expect(page.getByText('未保存到浏览器', { exact: true })).toBeVisible();
    expect(documents).toEqual([]);
    await page.screenshot({ path: `${EVIDENCE}/storage-private-reopened.png` });

    await page.reload();
    await expect(page.getByText('找不到这张导图', { exact: true })).toBeVisible();
    await expect(page.getByText('未保存到浏览器', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '返回导图列表' })).toHaveAttribute('href', '/');
    await expect(page.getByTestId('map-editor-ready')).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/storage-private-reloaded.png` });
  });

  test('Write failure is visible without losing the inline rename or changing the stored record', async ({
    page,
  }) => {
    const map = {
      id: 'quota-map',
      title: '写入失败测试',
      createdAt: '2026-11-06T10:00:00.000Z',
      updatedAt: '2026-11-06T10:00:00.000Z',
      roots: [{ id: 'quota-root', text: '原始文字', children: [] }],
    };
    const record = envelopeOf(map);
    await seedRecords(page, [record]);
    await page.addInitScript((store) => {
      const original: unknown = Object.getOwnPropertyDescriptor(
        IDBObjectStore.prototype,
        'put',
      )?.value;
      if (typeof original !== 'function') throw new Error('IndexedDB put method is unavailable');
      const put = original as IDBObjectStore['put'];
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        if (this.name === store) throw new DOMException('Quota exhausted', 'QuotaExceededError');
        return put.call(this, value, key);
      };
    }, MAP_STORE);
    await page.goto('/maps/quota-map');
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    const root = page.locator('.react-flow__node');
    await root.dblclick();
    const input = page.getByRole('textbox', { name: '节点标题' });
    await input.fill('写入失败也不丢失');
    await input.press('Enter');
    const notice = page.getByRole('alert').filter({ hasText: '保存失败' });
    await expect(notice).toBeVisible();
    await expect(root).toHaveText('写入失败也不丢失');
    await expect(root).toBeVisible();
    await expect(page.getByText('未保存到浏览器', { exact: true })).toHaveCount(0);
    expect(await readRecord(page, 'quota-map')).toStrictEqual(record.value);
    await page.screenshot({ path: `${EVIDENCE}/storage-write-failed.png` });
    await page.getByRole('button', { name: '关闭提示' }).click();
    await expect(notice).toHaveCount(0);
    await expect(root).toHaveText('写入失败也不丢失');
  });
});
