import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test } from './support/session';

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
  await expect(adminPage.getByRole('button', { name: '重置密码' })).toHaveCount(0);
  await adminPage.screenshot({ path: '.run/ui-evidence/account-admin.png', fullPage: true });
  expect(noise).toEqual([]);
});
