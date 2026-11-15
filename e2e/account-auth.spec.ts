import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('account-auth: Register and land signed in', async ({ page }) => {
  const username = `alice-${randomUUID()}`;
  await page.goto('/register');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('app-ready')).toBeVisible();
  const session = await page.request.get('/api/auth/session');
  expect(session.status()).toBe(200);
  expect(await session.json()).toMatchObject({ username });
});

test('account-auth: Sign in', async ({ page, request }) => {
  const username = `alice-${randomUUID()}`;
  const registration = await request.post('/api/auth/register', {
    data: { username, password: 'pw' },
  });
  expect(registration.status()).toBe(201);
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('app-ready')).toBeVisible();
  const session = await page.request.get('/api/auth/session');
  expect(session.status()).toBe(200);
  expect(await session.json()).toMatchObject({ username });
});
