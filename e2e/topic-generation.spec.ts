import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { collectExpectedResponses } from './support/expected-responses';
import { test } from './support/session';

// The mock generation walk ("Issue #311 Fixture Triage"). scripts/e2e-server.mjs forces the mock:
// 5 ops at 150 ms, so the node count after k ops is 1 + 4 + 3(k − 1): 5, 8, 11, 14, 17. Every
// timing assertion is a range all pacing outcomes satisfy. Every test rejects any console error,
// warning or uncaught page error; an aborted fetch logs nothing in Chromium, so none is declared.

const EVIDENCE = '.run/ui-evidence';
mkdirSync(EVIDENCE, { recursive: true });
const TOPIC = '学习 TypeScript';
const COMPLETE = 17;
const FIRST_LEVEL = ['要点 1', '要点 2', '要点 3', '要点 4'];
const STREAM_ERROR = '生成中断：AI 服务出错，请稍后重试';

const nodes = (page: Page) => page.locator('.react-flow__node');
const node = (page: Page, text: string) =>
  nodes(page).getByRole('button', { name: text, exact: true });
const stop = (page: Page) => page.getByRole('button', { name: '停止生成', exact: true });
const title = (page: Page) => page.getByTestId('editor-title');

async function capture(page: Page, name: string) {
  await page.screenshot({ path: `${EVIDENCE}/topic-generation-${name}.png`, fullPage: true });
}

// Opens a new map from the hydrated library by client navigation, as a user does.
async function openNewMap(page: Page): Promise<string> {
  await page.goto('/');
  await expect(page.getByText('还没有导图')).toBeVisible();
  await page.getByRole('button', { name: '新建导图' }).click();
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  await expect(nodes(page)).toHaveText(['新导图']);
  return new URL(page.url()).pathname.slice('/maps/'.length);
}

async function submit(page: Page, topic: string) {
  await page.getByRole('textbox', { name: '主题' }).fill(topic);
  await page.getByRole('button', { name: '生成', exact: true }).click();
}

// Resolves in the first animation frame where op 1 (`要点 1`–`要点 4`) is rendered, sampling
// that same frame: a buffered response would already show all 17 nodes and no Stop.
async function firstOp(page: Page): Promise<{ count: number; stopping: boolean }> {
  const sample = await page.waitForFunction(
    () => {
      if (document.querySelector('.react-flow__node [aria-label="要点 4"]') === null) return false;
      return {
        count: document.querySelectorAll('.react-flow__node').length,
        stopping: [...document.querySelectorAll('button')].some(
          (button) => button.textContent === '停止生成',
        ),
      };
    },
    undefined,
    { polling: 'raf' },
  );
  const value = await sample.jsonValue();
  if (value === false) throw new Error('waitForFunction resolved without a sample');
  return value;
}

async function expectComplete(page: Page) {
  await expect(nodes(page)).toHaveCount(COMPLETE);
  await expect(stop(page)).toHaveCount(0);
  await expect(node(page, '要点 4.3')).toBeVisible();
}

async function expectFirstLevel(page: Page) {
  for (const text of FIRST_LEVEL) await expect(node(page, text)).toBeVisible();
}

async function partialCount(page: Page): Promise<number> {
  const count = await nodes(page).count();
  expect(count).toBeGreaterThanOrEqual(5);
  expect(count).toBeLessThanOrEqual(14);
  return count;
}

test.describe('topic-generation', () => {
  let noise: () => Promise<string[]>;
  test.beforeEach(({ page }) => {
    const collector = collectExpectedResponses(page, []);
    noise = () => collector.noise();
  });
  test.afterEach(async () => {
    expect(await noise()).toEqual([]);
  });

  test('Progressive appearance', async ({ page }) => {
    await openNewMap(page);
    await submit(page, TOPIC);
    const sample = await firstOp(page);
    await capture(page, 'mid-stream');
    expect(sample.stopping).toBe(true);
    expect(sample.count).toBeLessThanOrEqual(14);
    await expectComplete(page);
    await expect(node(page, TOPIC)).toBeVisible();
    await expect(title(page)).toHaveText(TOPIC);
    await capture(page, 'complete');
  });

  test('Stop', async ({ page }) => {
    await openNewMap(page);
    await submit(page, TOPIC);
    await firstOp(page);
    await stop(page).click();
    await expect(stop(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '关闭提示' })).toHaveCount(0);
    const count = await partialCount(page);
    // Longer than the rest of the stream (4 × 150 ms): a stream still running would add nodes.
    await page.waitForTimeout(1000);
    await expect(nodes(page)).toHaveCount(count);
    await expectFirstLevel(page);
    await capture(page, 'stopped');
    await page.getByRole('button', { name: '适应画布' }).click();
    await node(page, TOPIC).click();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: '节点标题' })).toBeFocused();
    await expect(nodes(page)).toHaveCount(count + 1);
  });

  test('Mid-stream error', async ({ page }) => {
    await openNewMap(page);
    await submit(page, 'mock:error-after-2');
    await expect(page.getByRole('alert').filter({ hasText: STREAM_ERROR })).toBeVisible();
    await expect(stop(page)).toHaveCount(0);
    await expect(nodes(page)).toHaveCount(8);
    await capture(page, 'stream-error');
  });

  test('Leaving saves partial result', async ({ page }) => {
    await openNewMap(page);
    const aborted = page
      .waitForEvent('requestfailed', {
        predicate: (request) => new URL(request.url()).pathname === '/api/ai/generate',
      })
      .then(() => Date.now());
    await submit(page, TOPIC);
    await firstOp(page);
    const left = Date.now();
    await page.goBack();
    const abortedAt = await aborted;
    process.stdout.write(`leave-to-abort: ${String(abortedAt - left)} ms\n`);
    await expect(page.getByRole('listitem').getByRole('link')).toHaveText([TOPIC]);
    await page.getByRole('link', { name: TOPIC, exact: true }).click();
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expectFirstLevel(page);
    await partialCount(page);
    await capture(page, 'left-reopened');
  });

  test('Saved after completion', async ({ page }) => {
    const id = await openNewMap(page);
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/maps/${id}` &&
        response.request().method() === 'PUT' &&
        (response.request().postData() ?? '').includes('要点 4.3'),
    );
    await page.getByRole('textbox', { name: '主题' }).fill(TOPIC);
    await page.getByRole('textbox', { name: '主题' }).press('Enter');
    await expectComplete(page);
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    await expectComplete(page);
    await capture(page, 'reloaded');
  });

  test('Undo completed generation', async ({ page }) => {
    await openNewMap(page);
    await submit(page, TOPIC);
    await expectComplete(page);
    await page.getByRole('region', { name: '思维导图画布' }).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(nodes(page)).toHaveText(['新导图']);
    await expect(title(page)).toHaveText(TOPIC);
    await capture(page, 'undone');
  });
});
