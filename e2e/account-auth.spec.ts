import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createMindMap } from '../src/contexts/map/domain/create-mind-map';
import { envelopeOf, seedRecords } from './support/seed';

test('account-auth: Register and land signed in', async ({ page }) => {
  const username = `alice-${randomUUID()}`;
  await page.goto('/register');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('app-ready')).toBeVisible();
  await expect(page.getByTestId('session-username')).toHaveText(username);
  const session = await page.request.get('/api/auth/session');
  expect(session.status()).toBe(200);
  expect(await session.json()).toMatchObject({ username });
});

test('account-auth: Sign out', async ({ page, playwright }) => {
  const noise: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') noise.push(message.text());
  });
  page.on('pageerror', (error) => {
    noise.push(String(error));
  });
  const username = `alice-${randomUUID()}`;
  await page.goto('/register');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByTestId('session-username')).toHaveText(username);
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === 'mindsprout_session',
  );
  expect(cookie).toBeDefined();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL('/login');
  const replay = await playwright.request.newContext({
    baseURL: new URL(page.url()).origin,
    extraHTTPHeaders: { Cookie: `mindsprout_session=${cookie?.value ?? ''}` },
  });
  try {
    expect((await replay.get('/api/auth/session')).status()).toBe(401);
  } finally {
    await replay.dispose();
  }
  expect(noise).toEqual([]);
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

test('account-auth: Signed-out visit returns after sign-in', async ({ page }) => {
  const missing: string[] = [];
  const noise: string[] = [];
  page.on('response', (response) => {
    if (response.status() === 404) missing.push(response.url());
  });
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      noise.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    noise.push(`pageerror: ${String(error)}`);
  });

  const username = `return-${randomUUID()}`;
  const password = `pw-${randomUUID()}`;
  await page.goto('/register');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('app-ready')).toBeVisible();
  const map = createMindMap({
    id: 'abc',
    rootId: 'root',
    title: '返回我的导图',
    rootText: '我的想法',
  });
  await seedRecords(page, [envelopeOf(map)]);
  await page.context().clearCookies();
  await page.goto('/maps/abc');
  await expect(page).toHaveURL('/login?next=%2Fmaps%2Fabc');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/maps/abc');
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  await expect(page.getByTestId('editor-title')).toHaveText('返回我的导图');
  await expect(page.getByTestId('session-username')).toHaveText(username);
  await page.screenshot({ path: '.run/ui-evidence/account-sign-in-return.png' });
  expect(missing).toEqual([]);
  expect(noise).toEqual([]);
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
