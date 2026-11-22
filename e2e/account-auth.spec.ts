import {
  test,
  expect,
  type Page,
  type Request as BrowserRequest,
  type Response as BrowserResponse,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createMindMap } from '../src/contexts/map/domain/create-mind-map';
import { envelopeOf, readRecord, seedRecords } from './support/seed';
import { collectExpectedResponses } from './support/expected-responses';
import { E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME } from './support/session';

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
  await page.screenshot({ path: '.run/ui-evidence/account-auth-login-link.png' });
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  await register.click();
  await expect(page).toHaveURL(registerUrl);
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  expect(credentialRequests).toEqual([]);

  const login = page.getByRole('link', { name: '登录', exact: true });
  await expect(login).toHaveAttribute('href', loginUrl);
  await page.screenshot({ path: '.run/ui-evidence/account-auth-register-link.png' });
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

test('account-auth: Sign out wins over a delayed library 401', async ({ page, playwright }) => {
  const pendingList = gate();
  const listArrived = gate();
  const listRequests: BrowserRequest[] = [];
  const pendingLogin = gate();
  const loginArrived = gate();
  const noise = collectExpectedResponses(page, [{ url: '/api/maps', status: 401 }]);
  const expiryNavigations: string[] = [];
  const isPath = (path: string) => (url: URL) => url.pathname === path;
  const signedUp = await page.request.post('/api/auth/register', {
    data: { username: `signout-${randomUUID()}`, password: 'pw' },
  });
  expect(signedUp.status()).toBe(201);
  const cookiesBefore = await page.context().cookies();
  const oldCookie = cookiesBefore.find((cookie) => cookie.name === 'mindsprout_session');
  if (!oldCookie) throw new Error('Registration did not issue a session cookie');

  page.on('request', (request) => {
    const { pathname, search } = new URL(request.url());
    if (pathname === '/login' && new URLSearchParams(search).has('next'))
      expiryNavigations.push(search);
  });
  await page.route(isPath('/api/maps'), async (route) => {
    listRequests.push(route.request());
    listArrived.release();
    await pendingList.promise;
    await route.continue();
  });
  await page.route(isPath('/login'), async (route) => {
    if (!new URL(route.request().url()).searchParams.has('next')) loginArrived.release();
    await pendingLogin.promise;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await listArrived.promise;
    const logout = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/logout',
    );
    await page.getByRole('button', { name: '退出登录' }).click();
    expect((await logout).status()).toBe(204);
    await loginArrived.promise;
    await expect(page.getByTestId('app-ready')).toBeVisible();
    pendingList.release();
    for (const request of listRequests) expect((await request.response())?.status()).toBe(401);
    // Keep the outgoing document mounted until the denied fetch has been processed.
    await expect(page.getByTestId('app-ready')).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    pendingLogin.release();
    await expect(page).toHaveURL('/login');
    await expect(page.getByTestId('login-ready')).toBeVisible();
    expect(expiryNavigations).toEqual([]);
    expect((await page.context().cookies()).map(({ name }) => name)).not.toContain(
      'mindsprout_session',
    );
    await page.screenshot({ path: '.run/ui-evidence/account-signout-race.png' });
    expect(await noise.noise()).toEqual([]);
  } finally {
    pendingList.release();
    pendingLogin.release();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
  const replay = await playwright.request.newContext({
    baseURL: new URL(page.url()).origin,
    extraHTTPHeaders: { Cookie: `mindsprout_session=${oldCookie.value}` },
  });
  try {
    expect((await replay.get('/api/auth/session')).status()).toBe(401);
  } finally {
    await replay.dispose();
  }
});

test('account-auth: Sign out survives a protected link interrupting login', async ({ page }) => {
  const observed = collectExpectedResponses(page, [
    { url: '/api/maps', status: 401 },
    { url: '/api/auth/session', status: 401 },
  ]);
  const account = await page.request.post('/api/auth/register', {
    data: { username: `signout-interrupt-${randomUUID()}`, password: 'pw' },
  });
  expect(account.status()).toBe(201);
  const session = (await page.context().cookies()).find(
    ({ name }) => name === 'mindsprout_session',
  );
  if (!session) throw new Error('Registration did not issue a session cookie');
  const map = createMindMap({ id: 'interrupt', rootId: 'r', title: 'Interrupt', rootText: 'Root' });
  await seedRecords(page, [envelopeOf(map)]);
  await page.goto('/maps/interrupt');
  const returnLink = page.getByRole('link', { name: '返回导图列表' });
  await expect(returnLink).toBeVisible();

  // Supply only the protected route shell that a signed-in prefetch could have cached.
  // Development disables prefetch; all browser cookies and subsequent API calls stay signed out.
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const headers = route.request().headers();
      expect(headers.rsc).toBe('1');
      const library = await route.fetch({
        headers: { ...headers, cookie: `${session.name}=${session.value}` },
        maxRedirects: 0,
      });
      expect(library.status()).toBe(200);
      await route.fulfill({ response: library });
    },
  );

  const loginArrived = gate();
  const heldLogin = gate();
  const heldDocument = gate();
  const expiryNavigations: string[] = [];
  const rootCommit = page.waitForURL('/', { timeout: 5_000 });
  await page.route(
    (url) => url.pathname === '/login',
    async (route) => {
      const request = route.request();
      const { search } = new URL(request.url());
      if (new URLSearchParams(search).has('next')) expiryNavigations.push(search);
      if (request.isNavigationRequest()) await heldDocument.promise;
      else {
        loginArrived.release();
        await heldLogin.promise;
      }
      await route.continue();
    },
  );
  try {
    const logout = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/logout',
    );
    await page.getByRole('button', { name: '退出登录' }).click();
    expect((await logout).status()).toBe(204);
    await loginArrived.promise;
    const denied = ['/api/maps', '/api/auth/session'].map((path) =>
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === path && response.status() === 401,
        { timeout: 5_000 },
      ),
    );
    await returnLink.click();
    await rootCommit;
    await Promise.all(denied);
    heldDocument.release();
    await expect(page).toHaveURL('/login');
    await expect(page.getByTestId('login-ready')).toBeVisible();
    expect(expiryNavigations).toEqual([]);
    await page.screenshot({
      path: '.run/ui-evidence/account-signout-interrupted.png',
      caret: 'initial',
    });
    expect(await observed.noise()).toEqual([]);
  } finally {
    heldLogin.release();
    heldDocument.release();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

for (const surface of ['library', 'admin list', 'admin reset'] as const) {
  test(`account-auth: Genuine ${surface} expiry opens a fresh login document`, async ({ page }) => {
    const path = surface === 'library' ? '/' : '/admin';
    const listUrl = surface === 'library' ? '/api/maps' : '/api/admin/users';
    const responseUrl =
      surface === 'admin reset' ? /\/api\/admin\/users\/[^/]+\/password-reset$/ : listUrl;
    const observed = collectExpectedResponses(page, [{ url: responseUrl, status: 401 }]);
    const account =
      surface === 'library'
        ? { username: `expiry-${randomUUID()}`, password: 'pw' }
        : { username: E2E_ADMIN_USERNAME, password: E2E_ADMIN_PASSWORD };
    const mode = surface === 'library' ? 'register' : 'login';
    const setup = await page.request.post(`/api/auth/${mode}`, { data: account });
    expect(setup.status()).toBe(surface === 'library' ? 201 : 200);
    const pendingList = gate();
    const document = page.waitForRequest(
      (request) => request.isNavigationRequest() && new URL(request.url()).pathname === '/login',
    );
    if (surface !== 'admin reset') {
      await page.route(`**${listUrl}`, async (route) => {
        await pendingList.promise;
        await route.continue();
      });
    }
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('session-username')).toHaveText(account.username);
      expect((await page.request.post('/api/auth/logout', { data: {} })).status()).toBe(204);
      const denied = page.waitForResponse((response) => {
        const { pathname } = new URL(response.url());
        return typeof responseUrl === 'string'
          ? pathname === responseUrl
          : responseUrl.test(pathname);
      });
      if (surface === 'admin reset') {
        page.once('dialog', (dialog) => dialog.accept());
        await page
          .getByRole('button', { name: `重置密码 ${account.username}`, exact: true })
          .click();
      } else {
        pendingList.release();
      }
      expect((await denied).status()).toBe(401);
      const expected = `/login?next=${encodeURIComponent(path)}`;
      expect(new URL((await document).url()).search).toBe(new URL(expected, page.url()).search);
      await expect(page).toHaveURL(expected);
      await expect(page.getByTestId('login-ready')).toBeVisible();
      await page.screenshot({
        path: `.run/ui-evidence/account-expiry-${surface.replace(' ', '-')}.png`,
        caret: 'initial',
      });
      expect(await observed.noise()).toEqual([]);
    } finally {
      pendingList.release();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
}

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

// ES2022 lacks Promise.withResolvers; each gate is released by the scenario's finally.
function gate() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function holdNextPut(page: Page, path: string) {
  const held = gate();
  const arrived = gate();
  let writes = 0;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === 'PUT' && ++writes === 1) {
      arrived.release();
      await held.promise;
    }
    await route.continue();
  });
  return { release: held.release, arrived: arrived.promise, writes: () => writes };
}

async function login(page: Page, username: string) {
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('pw');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByTestId('session-username')).toHaveText(username);
}

for (const transition of ['same-document', 'new-tab'] as const) {
  test(`account-auth: Queued Alice saves cannot enter Bob store after ${transition} login`, async ({
    page,
    request,
  }) => {
    const alice = `alice-${randomUUID()}`;
    const bob = `bob-${randomUUID()}`;
    expect(
      (
        await request.post('/api/auth/register', { data: { username: bob, password: 'pw' } })
      ).status(),
    ).toBe(201);
    expect(
      (
        await page.request.post('/api/auth/register', { data: { username: alice, password: 'pw' } })
      ).status(),
    ).toBe(201);
    const map = createMindMap({
      id: 'alice-private',
      rootId: 'r',
      title: 'Alice private',
      rootText: 'Seed',
    });
    const path = `/api/maps/${map.id}`;
    const expected = collectExpectedResponses(page, [{ url: path, status: 401 }]);
    const responses: BrowserResponse[] = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === path && response.request().method() === 'PUT') {
        responses.push(response);
      }
    });
    await seedRecords(page, [envelopeOf(map)]);
    let held = await holdNextPut(page, path);
    let loginPage = page;
    let loginNoise: (() => Promise<string[]>) | undefined;
    try {
      await page.goto(`/maps/${map.id}`);
      await expect(page.getByTestId('map-editor-ready')).toBeVisible();
      const document = await page.evaluateHandle(() => window.document);
      const edit = async (text: string) => {
        await page.locator('.react-flow__node[data-id="r"]').dblclick();
        const input = page.getByRole('textbox', { name: '节点标题' });
        await input.fill(text);
        await input.press('Enter');
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      };
      if (transition === 'new-tab') {
        await edit('Alice before same-account re-login');
        await held.arrived;
        await edit('Alice newest recovered edit');
        expect(held.writes()).toBe(1);
        loginPage = await page.context().newPage();
        const collector = collectExpectedResponses(loginPage, []);
        loginNoise = () => collector.noise();
        await loginPage.goto('/login');
        await login(loginPage, alice);
        held.release();
        await expect.poll(() => responses.length).toBe(2);
        for (const response of responses) await response.finished();
        expect(responses.map((response) => response.status())).toEqual([204, 204]);
        expect(await readRecord(page, map.id)).toMatchObject({
          map: { roots: [{ id: 'r', text: 'Alice newest recovered edit' }] },
        });
        expect(await document.evaluate((original) => original === window.document)).toBe(true);
        responses.length = 0;
        held = await holdNextPut(page, path);
      }
      await edit('Alice first private edit');
      await held.arrived;
      await edit('Alice newer sensitive edit');
      expect(held.writes()).toBe(1);
      if (transition === 'same-document') {
        await page.getByRole('button', { name: '退出登录' }).click();
        await expect(page).toHaveURL('/login');
      } else {
        await loginPage.goto('/login');
      }
      await login(loginPage, bob);
      expect(await document.evaluate((original) => original === window.document)).toBe(true);
      held.release();
      await expect.poll(() => responses.length).toBe(2);
      for (const response of responses) await response.finished();
      expect.soft(await readRecord(loginPage, map.id)).toBeUndefined();
      expect(responses.map((response) => response.status())).toEqual([401, 401]);
      const list = await loginPage.request.get('/api/maps');
      expect(await list.json()).toEqual([]);
      await expect(loginPage.getByTestId('app-ready')).toBeVisible();
      await loginPage.getByRole('button', { name: '新建导图' }).click();
      await expect(loginPage.getByTestId('map-editor-ready')).toBeVisible();
      const ownId = new URL(loginPage.url()).pathname.split('/').at(-1);
      if (!ownId) throw new Error('Bob editor has no map id');
      expect(await readRecord(loginPage, ownId)).toBeDefined();
      await loginPage.reload();
      await expect(loginPage.getByTestId('map-editor-ready')).toBeVisible();
      await loginPage.screenshot({ path: `.run/ui-evidence/account-binding-${transition}.png` });
      expect(await expected.noise()).toEqual([]);
      if (loginNoise) expect(await loginNoise()).toEqual([]);
    } finally {
      held.release();
      await page.unrouteAll({ behavior: 'wait' });
      if (loginPage !== page) await loginPage.close();
    }
  });
}

for (const transition of ['same-document', 'new-tab'] as const) {
  test(`account-auth: Credential-only legacy session fails closed and recovers before ${transition} login`, async ({
    page,
    request,
  }) => {
    const alice = `legacy-alice-${randomUUID()}`;
    const bob = `legacy-bob-${randomUUID()}`;
    expect(
      (
        await request.post('/api/auth/register', { data: { username: bob, password: 'pw' } })
      ).status(),
    ).toBe(201);
    expect(
      (
        await page.request.post('/api/auth/register', { data: { username: alice, password: 'pw' } })
      ).status(),
    ).toBe(201);
    const map = createMindMap({
      id: 'legacy-alice-private',
      rootId: 'r',
      title: 'Legacy Alice private',
      rootText: 'Legacy Alice seed',
    });
    const path = `/api/maps/${map.id}`;
    await seedRecords(page, [envelopeOf(map)]);
    await page.context().clearCookies({ name: 'mindsprout_session_binding' });
    expect((await page.context().cookies()).map(({ name }) => name)).toContain(
      'mindsprout_session',
    );
    expect((await page.context().cookies()).map(({ name }) => name)).not.toContain(
      'mindsprout_session_binding',
    );
    const expected = collectExpectedResponses(page, [{ url: path, status: 401 }]);
    const initialRequest = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'GET',
    );
    await page.goto(`/maps/${map.id}`);
    const initial = await initialRequest;
    if (initial.status() === 200) {
      await expect(page.getByTestId('map-editor-ready')).toBeVisible();
      await page.screenshot({
        path: `.run/ui-evidence/account-legacy-${transition}-exposed.png`,
      });
    }
    expect(initial.status()).toBe(401);
    expect(initial.request().headers()['x-mindsprout-session-binding']).toBe('');
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/maps/${map.id}`)}`);
    await expect(page.getByTestId('map-editor-ready')).toHaveCount(0);
    await page.screenshot({
      path: `.run/ui-evidence/account-legacy-${transition}-closed.png`,
      caret: 'initial',
    });
    await login(page, alice);
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    const document = await page.evaluateHandle(() => window.document);
    const edit = async (target: Page, text: string) => {
      await target.locator('.react-flow__node').first().dblclick();
      const input = target.getByRole('textbox', { name: '节点标题' });
      await input.fill(text);
      await input.press('Enter');
      await target.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    };
    const recoveredSave = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'PUT',
    );
    await edit(page, 'Alice recovered legacy edit');
    expect((await recoveredSave).status()).toBe(204);
    expect(await readRecord(page, map.id)).toMatchObject({
      map: { roots: [{ id: 'r', text: 'Alice recovered legacy edit' }] },
    });
    await page.screenshot({ path: `.run/ui-evidence/account-legacy-${transition}-recovered.png` });
    const loginPage = transition === 'new-tab' ? await page.context().newPage() : page;
    const loginNoise = loginPage === page ? undefined : collectExpectedResponses(loginPage, []);
    try {
      if (transition === 'same-document') {
        await page.getByRole('button', { name: '退出登录' }).click();
        await expect(page).toHaveURL('/login');
      } else {
        await loginPage.goto('/login');
      }
      await login(loginPage, bob);
      expect(await document.evaluate((original) => original === window.document)).toBe(true);
      if (transition === 'new-tab') {
        const deniedSave = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === path && response.request().method() === 'PUT',
        );
        await edit(page, 'Alice sensitive edit after Bob login');
        expect((await deniedSave).status()).toBe(401);
        await expect(page.getByRole('link', { name: '重新登录' })).toBeVisible();
      }
      expect(await readRecord(loginPage, map.id)).toBeUndefined();
      expect(await (await loginPage.request.get('/api/maps')).json()).toEqual([]);
      await expect(loginPage.getByTestId('app-ready')).toBeVisible();
      await loginPage.getByRole('button', { name: '新建导图' }).click();
      await expect(loginPage.getByTestId('map-editor-ready')).toBeVisible();
      const ownId = new URL(loginPage.url()).pathname.split('/').at(-1);
      if (!ownId) throw new Error('Bob editor has no map id');
      const ownSave = loginPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/maps/${ownId}` &&
          response.request().method() === 'PUT',
      );
      await edit(loginPage, 'Bob independent legacy recovery map');
      expect((await ownSave).status()).toBe(204);
      expect(await readRecord(loginPage, ownId)).toMatchObject({
        map: { roots: [{ text: 'Bob independent legacy recovery map' }] },
      });
      await loginPage.reload();
      await expect(loginPage.getByTestId('map-editor-ready')).toBeVisible();
      await expect(loginPage.locator('.react-flow__node').first()).toContainText(
        'Bob independent legacy recovery map',
      );
      await loginPage.screenshot({ path: `.run/ui-evidence/account-legacy-${transition}-bob.png` });
      expect(await expected.noise()).toEqual([]);
      if (loginNoise) expect(await loginNoise.noise()).toEqual([]);
    } finally {
      if (loginPage !== page) await loginPage.close();
    }
  });
}
