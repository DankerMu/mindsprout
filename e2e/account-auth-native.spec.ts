import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

async function submitNatively(
  page: Page,
  mode: 'login' | 'register',
  via: 'button' | 'Enter',
  scenario: { blockScripts: boolean; query: string; retryQuery: string },
) {
  const { blockScripts, query, retryQuery } = scenario;
  const username = `native-${randomUUID()}`;
  const password = `secret-${randomUUID()}`;
  const urls: string[] = [];
  const noise: string[] = [];
  const blockedScripts = new Set<string>();
  if (blockScripts) {
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, (route) => {
      blockedScripts.add(route.request().url());
      return route.abort('blockedbyclient');
    });
  }
  page.on('request', (request) => urls.push(request.url()));
  page.on('console', (message) => {
    if (
      blockedScripts.has(message.location().url) &&
      /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/.test(message.text())
    )
      return;
    if (message.type() === 'error' || message.type() === 'warning') noise.push(message.text());
  });
  page.on('pageerror', (error) => noise.push(`pageerror: ${String(error)}`));

  const formUrl = `/${mode}${query}`;
  const action = `/native-auth/${mode}${query}`;
  const location = `/${mode}${retryQuery}`;
  await page.goto(formUrl);
  await expect(page.getByRole('form')).toHaveAttribute('action', action);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  const navigation = page.waitForRequest((request) => request.isNavigationRequest());
  if (via === 'Enter') await page.getByLabel('密码').press('Enter');
  else await page.getByRole('button', { name: mode === 'login' ? '登录' : '注册' }).click();
  const submission = await navigation;
  expect(submission.method()).toBe('POST');
  const target = new URL(submission.url());
  expect(`${target.pathname}${target.search}`).toBe(action);
  const response = await submission.response();
  expect(response?.status()).toBe(303);
  expect(response?.headers().location).toBe(location);
  expect(await response?.headerValue('set-cookie')).toBeNull();
  await expect(page).toHaveURL(location);
  await expect(page.getByRole('alert')).toHaveText('请启用 JavaScript 或等待页面加载后重试。');
  const returnLink = page.getByRole('link', { name: '返回表单' });
  await expect(returnLink).toHaveAttribute('href', formUrl);
  await page.screenshot({
    path: `.run/ui-evidence/issue242-native-auth/${mode}-${via}-${blockScripts ? 'blocked' : 'no-js'}.png`,
  });
  urls.push(page.url());
  await returnLink.click();
  await expect(page).toHaveURL(formUrl);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const session = await page.request.get('/api/auth/session');
  expect(session.status()).toBe(401);
  for (const url of [...urls, page.url(), session.url()]) {
    expect(url).not.toContain(username);
    expect(url).not.toContain(password);
  }
  if (blockScripts) expect(blockedScripts.size).toBeGreaterThan(0);
  expect(noise).toEqual([]);
}

for (const scenario of [
  { blockScripts: false, query: '', retryQuery: '?native=1' },
  {
    blockScripts: true,
    query: '?next=%2Fmaps%2Fabc%3Fview%3Dtree',
    retryQuery: '?native=1&next=%2Fmaps%2Fabc%3Fview%3Dtree',
  },
]) {
  const { blockScripts } = scenario;
  test.describe(`account-auth: Native with ${blockScripts ? 'blocked scripts' : 'JavaScript disabled'}`, () => {
    test.use({ javaScriptEnabled: blockScripts });
    for (const mode of ['login', 'register'] as const) {
      for (const via of ['button', 'Enter'] as const) {
        test(`${mode} ${via} returns to a readable form without authenticating`, async ({
          page,
        }) => {
          await submitNatively(page, mode, via, scenario);
        });
      }
    }
  });
}

test('account-auth: Direct API form posts neither register nor sign in', async ({
  page,
  request,
}) => {
  const form = { username: `direct-${randomUUID()}`, password: `secret-${randomUUID()}` };
  for (const [mode, client] of [
    ['register', request],
    ['login', page.request],
  ] as const) {
    const response = await client.post(`/api/auth/${mode}`, { form, maxRedirects: 0 });
    expect(response.status()).toBe(415);
    expect(await response.json()).toEqual({ error: 'unsupported-media-type' });
    expect(response.headers()['set-cookie']).toBeUndefined();
    expect((await client.get('/api/auth/session')).status()).toBe(401);
    if (mode === 'register') {
      expect((await client.post('/api/auth/register', { data: form })).status()).toBe(201);
    }
  }
});

test('account-auth: Signed-out native namespace returns real 404s only inside its boundary', async ({
  request,
}) => {
  const options = { maxRedirects: 0 };
  const invalid = await request.post('/native-auth/other', options);
  const child = await request.get('/native-auth/login/child', options);
  expect(invalid.status()).toBe(404);
  expect(child.status()).toBe(404);
  const nearMiss = await request.get('/native-auth-extra', options);
  expect(nearMiss.status()).toBe(307);
  expect(nearMiss.headers().location).toMatch(/\/login\?next=%2Fnative-auth-extra$/);
});
