import { expect, type Page } from '@playwright/test';
import { test } from './support/session';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  holdCredentialHydration,
  releaseCredentialHydration,
  waitForCredentialHydrationWakeup,
} from './support/credential-hydration';
import { envelopeOf, seedRecords } from './support/seed';

// Key UI paths (Q7.3) — keep in sync with AGENTS.md ## Verification Matrix and
// constraints.yaml verification.key_ui_paths.
const EDITOR_MAP = {
  title: 'Smoke editor map',
  roots: [{ id: 'smoke-root', text: 'Smoke root content', children: [] }],
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
};
const routes: {
  path: string;
  name: string;
  ready: string;
  map?: typeof EDITOR_MAP;
}[] = [
  { path: '/', name: 'home', ready: 'app-ready' },
  { path: '/maps/[id]', name: 'editor', ready: 'map-editor-ready', map: EDITOR_MAP },
  { path: '/login', name: 'login', ready: 'login-ready' },
];

fs.mkdirSync('.run/ui-evidence', { recursive: true });

async function captureLoginBeforeHydration(page: Page) {
  await waitForCredentialHydrationWakeup(page);
  const form = page.getByRole('form', { name: '登录', exact: true });
  await expect(form).toBeVisible();
  expect(await form.getAttribute('data-hydrated')).toBeNull();

  const caretWrites = await form.evaluateHandle((element) => {
    const inputs = ['username', 'password'].map((name) => {
      const input = element.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (!input) throw new Error(`Missing ${name} input in login form`);
      return input;
    });
    const writes: { input: string; color: string }[] = [];
    const style = document.createElement('span').style;
    const recordWrites = (records: MutationRecord[]) => {
      const nextColors = new Map<Element, string>();
      // A later mutation's old style can retain a caret color already restored by capture.
      for (const record of records.reverse()) {
        const input = record.target as HTMLInputElement;
        const color = nextColors.get(input) ?? input.style.caretColor;
        style.cssText = record.oldValue ?? '';
        const previous = style.caretColor;
        if (color && color !== previous) writes.push({ input: input.name, color });
        nextColors.set(input, previous);
      }
    };
    const observer = new MutationObserver(recordWrites);
    for (const input of inputs)
      observer.observe(input, {
        attributeFilter: ['style'],
        attributeOldValue: true,
      });
    return () => {
      recordWrites(observer.takeRecords());
      observer.disconnect();
      return writes;
    };
  });

  await page.screenshot({ path: '.run/ui-evidence/login.png', fullPage: true, caret: 'initial' });

  expect
    .soft(await caretWrites.evaluate((finish) => finish()), 'caret writes during login screenshot')
    .toEqual([]);
  await caretWrites.dispose();
  expect(await form.getAttribute('data-hydrated')).toBeNull();
  await releaseCredentialHydration(page);
  await expect(form).toHaveAttribute('data-hydrated', 'true');
}

for (const route of routes) {
  test(`route ${route.path} renders without console errors`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    const map = route.map ? { ...route.map, id: randomUUID() } : undefined;
    if (map) await seedRecords(page, [envelopeOf(map)]);
    const path = map ? `/maps/${map.id}` : route.path;
    if (route.path === '/login') await holdCredentialHydration(page);
    const response = await page.goto(path);
    expect(response?.ok(), `HTTP status for ${path}`).toBe(true);
    await page.waitForLoadState('load');
    await page.waitForSelector(`[data-testid="${route.ready}"]`);
    if (map) {
      await expect(page.getByTestId('editor-title')).toBeVisible();
      await expect(page.getByTestId('editor-title')).toHaveText(map.title);
      const root = page.locator('.react-flow__node[data-id="smoke-root"]');
      await expect(root).toBeVisible();
      await expect(root).toHaveText('Smoke root content');
    }

    if (route.path === '/login') await captureLoginBeforeHydration(page);
    else await page.screenshot({ path: `.run/ui-evidence/${route.name}.png`, fullPage: true });

    expect(consoleErrors, `console errors on ${route.path}`).toEqual([]);
  });
}

test('route /admin renders without console errors', async ({ adminPage }) => {
  const consoleErrors: string[] = [];
  adminPage.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  adminPage.on('pageerror', (err) => consoleErrors.push(String(err)));
  const response = await adminPage.goto('/admin');
  expect(response?.ok(), 'HTTP status for /admin').toBe(true);
  await expect(adminPage.getByTestId('admin-ready')).toBeVisible();
  await expect(adminPage.getByTestId('session-username')).toHaveText('e2e-admin');
  await expect(adminPage.getByRole('link', { name: '管理后台' })).toHaveAttribute('href', '/admin');
  await expect(adminPage.getByRole('list', { name: '用户列表' })).toBeVisible();
  await adminPage.screenshot({ path: '.run/ui-evidence/admin.png', fullPage: true });
  expect(consoleErrors, 'console errors on /admin').toEqual([]);
});
