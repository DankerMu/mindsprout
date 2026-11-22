import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createMindMap } from '../src/contexts/map/domain/create-mind-map';
import { envelopeOf, seedRecords } from './support/seed';
import { collectExpectedResponses } from './support/expected-responses';

test('account-auth: Register and land signed in', async ({ page }) => {
  const username = `alice-${randomUUID()}`;
  await page.goto('/register');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  const registration = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/register' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '注册' }).click();
  expect((await registration).status()).toBe(201);
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('app-ready')).toBeVisible();
  await expect(page.getByTestId('session-username')).toHaveText(username);
  const session = await page.request.get('/api/auth/session');
  expect(session.status()).toBe(200);
  expect(await session.json()).toMatchObject({ username });
});

test('account-auth: Switching public forms does not submit credentials or create a session', async ({
  page,
}) => {
  const observed = collectExpectedResponses(page, []);
  const credentialRequests: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname === '/api/auth/login' || pathname === '/api/auth/register') {
      credentialRequests.push(`${request.method()} ${pathname}`);
    }
  });

  const loginUrl = '/login?next=%2Fmaps%2Fabc';
  const registerUrl = '/register?next=%2Fmaps%2Fabc';
  const username = `switch-${randomUUID()}`;

  await page.goto(loginUrl);
  const register = page.getByRole('link', { name: '注册', exact: true });
  await expect(register).toHaveAttribute('href', registerUrl);
  await page.screenshot({
    path: '.run/ui-evidence/account-auth-login-link.png',
    caret: 'initial',
  });
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  await register.click();
  await expect(page).toHaveURL(registerUrl);
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  expect(credentialRequests).toEqual([]);

  const login = page.getByRole('link', { name: '登录', exact: true });
  await expect(login).toHaveAttribute('href', loginUrl);
  await page.screenshot({
    path: '.run/ui-evidence/account-auth-register-link.png',
    caret: 'initial',
  });
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  await login.click();
  await expect(page).toHaveURL(loginUrl);
  await expect(register).toBeVisible();
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  expect(credentialRequests).toEqual([]);
  expect(await observed.noise()).toEqual([]);
});

test('account-auth: Signed-out visit returns after registration from sign-in', async ({ page }) => {
  const observed = collectExpectedResponses(page, []);
  const next = '/?from=first-visit&view=library';
  const username = `return-${randomUUID()}`;

  await page.goto(next);
  await expect(page).toHaveURL('/login?next=%2F%3Ffrom%3Dfirst-visit%26view%3Dlibrary');
  await page.getByRole('link', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL('/register?next=%2F%3Ffrom%3Dfirst-visit%26view%3Dlibrary');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  await page.getByRole('button', { name: '注册', exact: true }).click();

  await expect(page).toHaveURL(next);
  await expect(page.getByTestId('app-ready')).toBeVisible();
  await expect(page.getByTestId('session-username')).toHaveText(username);
  const session = await page.request.get('/api/auth/session');
  expect(session.status()).toBe(200);
  expect(await session.json()).toMatchObject({ username });
  await page.screenshot({ path: '.run/ui-evidence/account-register-return.png' });
  expect(await observed.noise()).toEqual([]);
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
  const signIn = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录' }).click();
  expect((await signIn).status()).toBe(200);
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

async function submitNatively(
  page: Page,
  mode: 'login' | 'register',
  via: 'button' | 'Enter',
  scenario: string,
) {
  const observed = collectExpectedResponses(page, []);
  const browserRequests: string[] = [];
  page.on('request', (request) => browserRequests.push(request.url()));

  const username = `native-${randomUUID()}`;
  const password = `fixture-${randomUUID()}`;
  const next = '%2Fmaps%2Fabc%3Fview%3Dtree';
  const label = mode === 'login' ? '登录' : '注册';
  await page.goto(`/${mode}?next=${next}`);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);

  const navigation = page.waitForRequest((request) => request.isNavigationRequest());
  if (via === 'Enter') await page.getByLabel('密码').press('Enter');
  else await page.getByRole('button', { name: label }).click();
  const submission = await navigation;
  const response = await submission.response();
  if (!response) throw new Error('Native POST did not receive a response');
  expect(submission.method()).toBe('POST');
  expect(new URL(submission.url()).pathname).toBe(`/${mode}/native`);
  expect(new URL(submission.url()).search).toBe(`?next=${next}`);
  expect(response.status()).toBe(303);
  expect(await response.headerValue('set-cookie')).toBeNull();

  const destination = `/${mode}?next=${next}&native=unavailable`;
  await expect(page).toHaveURL(destination);
  const returnedForm = submission.redirectedTo();
  if (!returnedForm) throw new Error('Browser did not follow the native redirect');
  expect(returnedForm.method()).toBe('GET');
  expect(returnedForm.postData()).toBeNull();
  expect((await returnedForm.response())?.status()).toBe(200);
  expect(await response.headerValue('location')).toBe(page.url());
  await expect(page.getByRole('alert')).toHaveText('页面尚未加载完成，请重试');
  await expect(page.getByRole('form', { name: label })).toBeVisible();
  await expect(page.getByLabel('用户名')).toHaveValue('');
  await expect(page.getByLabel('密码')).toHaveValue('');
  await page.screenshot({ path: `.run/ui-evidence/account-native-${scenario}.png` });

  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  if (mode === 'register') {
    expect(
      (await page.request.post('/api/auth/login', { data: { username, password } })).status(),
    ).toBe(401);
  }
  expect(browserRequests).not.toContainEqual(
    expect.stringMatching(/\/api\/auth\/(login|register)/),
  );
  for (const url of [...browserRequests, page.url()]) {
    expect(url.includes(username) || url.includes(password)).toBe(false);
  }
  expect(await observed.noise()).toEqual([]);
}

test('account-auth: Direct API form posts cannot create an account or session', async ({
  page,
  request,
}) => {
  const credentials = { username: `direct-form-${randomUUID()}`, password: 'fixture-password' };
  const registration = await page.request.post('/api/auth/register', { form: credentials });
  expect(registration.status()).toBe(415);
  expect(await registration.json()).toEqual({ error: 'unsupported-media-type' });
  expect(registration.headers()['set-cookie']).toBeUndefined();
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);

  // JSON registration with the same username proves the form POST did not reserve it.
  expect((await request.post('/api/auth/register', { data: credentials })).status()).toBe(201);
  const login = await page.request.post('/api/auth/login', { form: credentials });
  expect(login.status()).toBe(415);
  expect(await login.json()).toEqual({ error: 'unsupported-media-type' });
  expect(login.headers()['set-cookie']).toBeUndefined();
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
});

test.describe('account-auth: Native without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  for (const mode of ['login', 'register'] as const) {
    for (const via of ['button', 'Enter'] as const) {
      test(`${mode} ${via} returns to a readable form without signing in`, async ({ page }) => {
        await submitNatively(page, mode, via, `${mode}-${via.toLowerCase()}-no-js`);
      });
    }
  }
});

test('account-auth: Native login Enter with hydration scripts blocked', async ({ page }) => {
  let blockedScripts = 0;
  // Withhold the script code without introducing unrelated network errors.
  await page.route('**/_next/static/**/*.js', (route) => {
    blockedScripts += 1;
    return route.fulfill({ contentType: 'application/javascript', body: '' });
  });
  await submitNatively(page, 'login', 'Enter', 'login-blocked-scripts');
  expect(blockedScripts).toBeGreaterThan(0);
});
