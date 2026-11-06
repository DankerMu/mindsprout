import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { envelopeOf, readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
const NOW = '2026-11-06T12:34:56.789Z';
const EARLY = '2026-11-05T10:00:00.000Z';
const LATE = '2026-11-05T11:00:00.000Z';
fs.mkdirSync(EVIDENCE, { recursive: true });

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
    await expect(page).toHaveURL(/\/maps\/[\w-]{21}$/);
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expect(page.getByTestId('editor-title')).toHaveText('新导图');
    const root = page.locator('.react-flow__node');
    await expect(root).toHaveCount(1);
    await expect(root).toHaveText('新导图');
    await expect(root).toBeVisible();
    const id = new URL(page.url()).pathname.slice('/maps/'.length);
    const rootId = await root.getAttribute('data-id');
    expect(rootId).toMatch(/^[\w-]{21}$/);
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
});
