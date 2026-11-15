import { test, expect, type Page } from '@playwright/test';
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

for (const mode of ['login', 'register'] as const) {
  test(`account-auth: Control character redirect stays home after ${mode}`, async ({
    page,
    request,
  }) => {
    const username = `control-${randomUUID()}`;
    if (mode === 'login') {
      const registration = await request.post('/api/auth/register', {
        data: { username, password: 'pw' },
      });
      expect(registration.status()).toBe(201);
    }
    await page.goto(`/${mode}?next=${encodeURIComponent('/\n/evil.example/x')}`);
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码').fill('pw');
    await page.getByRole('button', { name: mode === 'login' ? '登录' : '注册' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('app-ready')).toBeVisible();
    const session = await page.request.get('/api/auth/session');
    expect(session.status()).toBe(200);
    expect(await session.json()).toMatchObject({ username });
  });
}

async function submitNatively(page: Page, mode: 'login' | 'register', via: 'button' | 'Enter') {
  const username = `native-${randomUUID()}`;
  const password = `secret-${randomUUID()}`;
  await page.goto(`/${mode}`);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  const navigation = page.waitForRequest((request) => request.isNavigationRequest());
  if (via === 'Enter') await page.getByLabel('密码').press('Enter');
  else await page.getByRole('button', { name: mode === 'login' ? '登录' : '注册' }).click();
  const submission = await navigation;
  expect(submission.method()).toBe('POST');
  expect(new URL(submission.url()).pathname).toBe(`/api/auth/${mode}`);
  expect(submission.url()).not.toContain(username);
  expect(submission.url()).not.toContain(password);
  expect((await submission.response())?.status()).toBe(415);
  await expect(page).toHaveURL(submission.url());
  expect(page.url()).not.toContain(username);
  expect(page.url()).not.toContain(password);
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
}

test.describe('account-auth: Native without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  for (const mode of ['login', 'register'] as const) {
    for (const via of ['button', 'Enter'] as const) {
      test(`${mode} ${via} keeps credentials out of URLs`, async ({ page }) => {
        await submitNatively(page, mode, via);
      });
    }
  }
});

test('account-auth: Native login Enter with hydration scripts blocked', async ({ page }) => {
  await page.route('**/*.js', (route) => route.abort());
  await submitNatively(page, 'login', 'Enter');
});
