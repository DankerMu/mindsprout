import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test } from './support/session';
import { collectExpectedResponses } from './support/expected-responses';

// Automatic traces/screenshots could persist the temporary password on failure.
test.use({ trace: 'off', screenshot: 'off' });

test('account-admin: Admin sees all accounts', async ({ adminPage, playwright, baseURL }) => {
  const noise: string[] = [];
  adminPage.on('console', (message) => {
    if (message.type() === 'error') noise.push(message.text());
  });
  adminPage.on('pageerror', (error) => noise.push(String(error)));
  const first = `first-${randomUUID()}`;
  const second = `second-${randomUUID()}`;
  if (baseURL === undefined) throw new Error('Missing Playwright baseURL');
  const registration = await playwright.request.newContext({ baseURL });
  try {
    for (const username of [first, second]) {
      const response = await registration.post('/api/auth/register', {
        data: { username, password: 'pw' },
      });
      expect(response.status()).toBe(201);
    }
  } finally {
    await registration.dispose();
  }
  const response = await adminPage.request.get('/api/admin/users');
  expect(response.status()).toBe(200);
  const accounts = (await response.json()) as {
    username: string;
    createdAt: string;
    isAdmin: boolean;
  }[];
  await adminPage.goto('/admin');
  const rows = adminPage.getByRole('listitem');
  for (const username of ['e2e-admin', first, second]) {
    const account = accounts.find((item) => item.username === username);
    expect(account).toBeDefined();
    if (!account) throw new Error(`Missing account: ${username}`);
    const row = rows.filter({ has: adminPage.getByText(username, { exact: true }) });
    await expect(row).toBeVisible();
    await expect(row.locator('time')).toHaveText(account.createdAt);
    await expect(row.locator('time')).toHaveAttribute('datetime', account.createdAt);
    await expect(row.getByText('管理员', { exact: true })).toHaveCount(
      username === 'e2e-admin' ? 1 : 0,
    );
  }
  const names = await rows.locator('span:first-child').allTextContents();
  expect(names.indexOf('e2e-admin')).toBeLessThan(names.indexOf(first));
  expect(names.indexOf(first)).toBeLessThan(names.indexOf(second));
  await expect(adminPage.getByText('管理员', { exact: true })).toHaveCount(1);
  await expect(adminPage.getByRole('button', { name: '重置密码' })).toHaveCount(await rows.count());
  await expect(
    rows.filter({ hasNot: adminPage.getByRole('button', { name: '重置密码' }) }),
  ).toHaveCount(0);
  await adminPage.screenshot({ path: '.run/ui-evidence/account-admin.png', fullPage: true });
  expect(noise).toEqual([]);
});

function expected401(page: Page, path: string, method: string) {
  return Promise.all([
    page
      .waitForResponse(
        (response) => new URL(response.url()).pathname === path && response.status() === 401,
      )
      .then((response) => {
        expect(response.request().method()).toBe(method);
        expect(response.status()).toBe(401);
      }),
    page.waitForEvent(
      'console',
      (message) =>
        message.type() === 'error' &&
        new URL(message.location().url).pathname === path &&
        message.text().includes('status of 401'),
    ),
  ]);
}

test.describe('account-admin: one-time reset credential', () => {
  test('Reset signs the user out and issues a temporary password', async ({
    adminPage,
    browser,
    playwright,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error('Missing Playwright baseURL');
    const username = `reset-${randomUUID()}`;
    const password = `old-${randomUUID()}`;
    const registration = await playwright.request.newContext({ baseURL });
    try {
      const response = await registration.post('/api/auth/register', {
        data: { username, password },
      });
      expect(response.status()).toBe(201);
    } finally {
      await registration.dispose();
    }
    const first = await browser.newContext({ baseURL });
    try {
      const second = await browser.newContext({ baseURL });
      try {
        const oldPasswordPage = await first.newPage();
        const otherPage = await second.newPage();
        const declarations = [
          { url: '/api/auth/session', status: 401 },
          { url: '/api/maps', status: 401 },
        ];
        const oldExpected = collectExpectedResponses(oldPasswordPage, [
          ...declarations,
          { url: '/api/auth/login', status: 401 },
        ]);
        const otherExpected = collectExpectedResponses(otherPage, declarations);
        const adminExpected = collectExpectedResponses(adminPage, []);
        for (const page of [oldPasswordPage, otherPage]) {
          const response = await page.request.post('/api/auth/login', {
            data: { username, password },
          });
          expect(response.status()).toBe(200);
          await page.goto('/');
          await expect(page.getByTestId('app-ready')).toBeVisible();
          await expect(page.getByTestId('session-username')).toHaveText(username);
        }
        const accountsResponse = await adminPage.request.get('/api/admin/users');
        expect(accountsResponse.status()).toBe(200);
        const accounts = (await accountsResponse.json()) as { id: string; username: string }[];
        const target = accounts.find((account) => account.username === username);
        if (!target) throw new Error('Missing reset account');
        await adminPage.goto('/admin');
        const row = adminPage.getByRole('listitem').filter({
          has: adminPage.getByText(username, { exact: true }),
        });
        adminPage.once('dialog', async (dialog) => {
          expect(dialog.type()).toBe('confirm');
          expect(dialog.message()).toBe('重置后该用户的所有登录将失效');
          await dialog.accept();
        });
        const resetResponse = adminPage.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/admin/users/${target.id}/password-reset`,
        );
        await row.getByRole('button', { name: '重置密码' }).click();
        const response = await resetResponse;
        expect(response.request().method()).toBe('POST');
        expect(response.status()).toBe(200);
        const { temporaryPassword } = (await response.json()) as { temporaryPassword: string };
        expect(typeof temporaryPassword === 'string' && temporaryPassword.length > 0).toBe(true);
        const dialog = adminPage.getByRole('dialog', { name: '临时密码' });
        const input = dialog.getByRole('textbox', { name: '临时密码' });
        await expect(dialog).toBeVisible();
        expect((await input.inputValue()) === temporaryPassword).toBe(true);
        expect(await input.evaluate((element: HTMLInputElement) => element.readOnly)).toBe(true);
        await input.click();
        expect(
          await input.evaluate((element: HTMLInputElement) => ({
            start: element.selectionStart,
            end: element.selectionEnd,
            length: element.value.length,
            focused: document.activeElement === element,
          })),
        ).toEqual({
          start: 0,
          end: temporaryPassword.length,
          length: temporaryPassword.length,
          focused: true,
        });
        await adminPage.screenshot({
          path: '.run/ui-evidence/account-admin-reset.png',
          fullPage: true,
          mask: [input],
        });
        await dialog.getByRole('button', { name: '关闭' }).click();
        await expect(dialog).toHaveCount(0);
        expect((await adminPage.content()).includes(temporaryPassword)).toBe(false);
        await adminPage.reload();
        await expect(adminPage.getByRole('list', { name: '用户列表' })).toBeVisible();
        await expect(adminPage.getByRole('dialog')).toHaveCount(0);
        expect((await adminPage.content()).includes(temporaryPassword)).toBe(false);
        for (const page of [oldPasswordPage, otherPage]) {
          const session401 = expected401(page, '/api/auth/session', 'GET');
          const maps401 = expected401(page, '/api/maps', 'GET');
          await page.reload();
          await Promise.all([session401, maps401]);
          await expect(page.getByTestId('login-ready')).toBeVisible();
        }
        await oldPasswordPage.getByLabel('用户名').fill(username);
        await oldPasswordPage.getByLabel('密码', { exact: true }).fill(password);
        const login401 = expected401(oldPasswordPage, '/api/auth/login', 'POST');
        await oldPasswordPage.getByRole('button', { name: '登录', exact: true }).click();
        await login401;
        await expect(
          oldPasswordPage.getByRole('form', { name: '登录' }).getByRole('alert'),
        ).toHaveText('用户名或密码错误');
        await expect(oldPasswordPage.getByTestId('login-ready')).toBeVisible();
        await oldPasswordPage.getByLabel('密码', { exact: true }).fill(temporaryPassword);
        await oldPasswordPage.getByRole('button', { name: '登录', exact: true }).click();
        await expect(oldPasswordPage).toHaveURL('/');
        await expect(oldPasswordPage.getByTestId('app-ready')).toBeVisible();
        await expect(oldPasswordPage.getByTestId('session-username')).toHaveText(username);
        expect(await oldExpected.noise()).toEqual([]);
        expect(await otherExpected.noise()).toEqual([]);
        expect(await adminExpected.noise()).toEqual([]);
      } finally {
        await second.close();
      }
    } finally {
      await adminPage.close();
      await first.close();
    }
  });
});
