import { expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test } from './support/session';
import { collectExpectedResponses } from './support/expected-responses';

// Automatic traces/screenshots could persist the temporary password on failure.
test.use({ trace: 'off', screenshot: 'off' });

test('account-admin: Admin sees all accounts', async ({ adminPage, playwright, baseURL }) => {
  const expected = collectExpectedResponses(adminPage, []);
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
  await expect(adminPage.getByRole('button', { name: /^重置密码 / })).toHaveCount(names.length);
  for (const username of names) {
    const row = rows.filter({ has: adminPage.getByText(username, { exact: true }) });
    await expect(
      row.getByRole('button', { name: `重置密码 ${username}`, exact: true }),
    ).toHaveCount(1);
  }
  await adminPage.screenshot({ path: '.run/ui-evidence/account-admin.png', fullPage: true });
  expect(await expected.noise()).toEqual([]);
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

async function respondToResetConfirmation(
  page: Page,
  button: Locator,
  username: string,
  response: 'accept' | 'dismiss',
) {
  await Promise.all([
    page.waitForEvent('dialog').then(async (dialog) => {
      const type = dialog.type();
      const message = dialog.message();
      await dialog[response]();
      expect(type).toBe('confirm');
      expect(message).toBe(`确定重置 ${username} 的密码吗？重置后该用户的所有登录将失效`);
    }),
    button.click(),
  ]);
}

test.describe('account-admin: one-time reset credential', () => {
  let previousNoCopyPrompt: string | undefined;
  let resetCredential: string | undefined;

  test.beforeAll(() => {
    previousNoCopyPrompt = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    // Suppress teardown ARIA snapshots only while this describe owns the credential.
    process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
  });

  test.afterAll(() => {
    // Test fixtures run didFinishTest before afterAll; afterEach is too early to restore.
    if (previousNoCopyPrompt === undefined) delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    else process.env.PLAYWRIGHT_NO_COPY_PROMPT = previousNoCopyPrompt;
  });

  test.afterEach(async ({ adminPage }, testInfo) => {
    try {
      for (const error of testInfo.errors) {
        delete error.errorContext;
        if (resetCredential) {
          if (error.message)
            error.message = error.message.replaceAll(resetCredential, '[REDACTED]');
          if (error.stack) error.stack = error.stack.replaceAll(resetCredential, '[REDACTED]');
        }
      }
      // A test timeout can leave the test body's finally block pending.
      await adminPage.close();
    } finally {
      resetCredential = undefined;
    }
  });

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
        const resetButton = row.getByRole('button', { name: `重置密码 ${username}`, exact: true });
        const resetPath = `/api/admin/users/${target.id}/password-reset`;
        const resetRequests: string[] = [];
        adminPage.on('request', (request) => {
          const { pathname } = new URL(request.url());
          if (pathname.endsWith('/password-reset')) resetRequests.push(pathname);
        });
        await respondToResetConfirmation(adminPage, resetButton, username, 'dismiss');
        await expect(resetButton).toBeEnabled();
        await expect(adminPage.getByRole('dialog')).toHaveCount(0);
        for (const page of [oldPasswordPage, otherPage]) {
          expect((await page.request.get('/api/auth/session')).status()).toBe(200);
        }
        expect(resetRequests).toEqual([]);
        await row.screenshot({ path: '.run/ui-evidence/account-admin-reset-target.png' });

        const resetResponse = adminPage.waitForResponse(
          (response) => new URL(response.url()).pathname === resetPath,
        );
        await respondToResetConfirmation(adminPage, resetButton, username, 'accept');
        const response = await resetResponse;
        expect(resetRequests).toEqual([resetPath]);
        expect(response.request().method()).toBe('POST');
        expect(response.status()).toBe(200);
        const { temporaryPassword } = (await response.json()) as { temporaryPassword: string };
        resetCredential = temporaryPassword;
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
        await expect(resetButton).toBeFocused();
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
