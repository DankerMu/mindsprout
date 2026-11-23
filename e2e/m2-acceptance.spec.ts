import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { MindMap } from '../src/contexts/map/domain/types';
import { collectExpectedResponses, type ExpectedResponse } from './support/expected-responses';
import { envelopeOf, readRecord } from './support/seed';
import { E2E_ADMIN_USERNAME, E2E_ADMIN_PASSWORD } from './support/session';

const EVIDENCE = '.run/ui-evidence';
const NOW = '2026-11-16T12:00:00.000Z';
const CHILDREN = ['第一步：播种', '第二步：生长', '第三步：收获'];
const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const titleInput = (page: Page) => page.getByRole('textbox', { name: '节点标题' });
const fit = (page: Page) => page.getByRole('button', { name: '适应画布' }).click();

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `${EVIDENCE}/m2-acceptance-${name}.png`, fullPage: true });
}

async function authenticate(page: Page, username: string, action = '登录', password = 'pw') {
  const form = page.getByRole('form', { name: action, exact: true });
  await expect(form).toHaveAttribute('data-hydrated', 'true');
  await form.getByLabel('用户名').fill(username);
  await form.getByLabel('密码').fill(password);
  await form.getByRole('button', { name: action, exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('app-ready')).toBeVisible();
  await expect(page.getByTestId('session-username')).toHaveText(username);
}

declare global {
  interface Window {
    credentialHydration: { queued: (() => void)[]; release: () => void };
  }
}

test('M2 authentication waits for hydration after load', async ({ page }) => {
  const collector = collectExpectedResponses(page, []);
  await page.addInitScript(() => {
    const queued: (() => void)[] = [];
    let held = true;
    window.credentialHydration = {
      queued,
      release: () => {
        held = false;
        for (const send of queued.splice(0)) send();
      },
    };
    // React Scheduler posts null to wake its MessageChannel; hold the wakeup, not the scripts.
    window.MessageChannel = class extends MessageChannel {
      constructor() {
        super();
        this.port2.postMessage = new Proxy(this.port2.postMessage.bind(this.port2), {
          apply(send, _port, args: [unknown]) {
            if (held && args[0] === null) {
              queued.push(() => {
                send(...args);
              });
            } else send(...args);
          },
        });
      }
    };
  });

  const paths: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname === '/api/auth/login' || pathname.startsWith('/native-auth/'))
      paths.push(pathname);
  });
  await page.goto('/login?next=%2F', { waitUntil: 'load' });
  await page.waitForFunction(() => window.credentialHydration.queued.length > 0);
  const form = page.getByRole('form', { name: '登录', exact: true });
  await expect(form).toBeVisible();
  expect(await form.getAttribute('data-hydrated')).toBeNull();
  await form.evaluate((element) => {
    for (const type of ['input', 'submit']) {
      element.addEventListener(
        type,
        () => {
          if (element.getAttribute('data-hydrated') !== 'true') {
            throw new Error(`${type} reached the credential form before its mount effect`);
          }
        },
        true,
      );
    }
  });

  const response = page.waitForResponse(
    (result) => new URL(result.url()).pathname === '/api/auth/login',
  );
  const [login] = await Promise.all([
    response,
    authenticate(page, E2E_ADMIN_USERNAME, '登录', E2E_ADMIN_PASSWORD),
    (async () => {
      await screenshot(page, 'hydration-held-after-load');
      expect(paths).toEqual([]);
      await expect(form.getByLabel('用户名')).toBeEmpty();
      expect(await form.getAttribute('data-hydrated')).toBeNull();
      await page.evaluate(() => {
        window.credentialHydration.release();
      });
    })(),
  ]);
  expect(login.status()).toBe(200);
  expect(login.request().method()).toBe('POST');
  expect(login.request().headers()['content-type']).toBe('application/json');
  expect(login.request().postDataJSON()).toEqual({
    username: E2E_ADMIN_USERNAME,
    password: E2E_ADMIN_PASSWORD,
  });
  expect(paths).toEqual(['/api/auth/login']);
  expect(await collector.noise()).toEqual([]);
  await screenshot(page, 'hydration-released-library');
});

async function signOut(page: Page) {
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL('/login');
}

function mapResponse(page: Page, id: string, method: string) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/maps/${id}` &&
      response.request().method() === method,
  );
}

async function createMap(page: Page) {
  await page.getByRole('button', { name: '新建导图' }).click();
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  const id = new URL(page.url()).pathname.slice('/maps/'.length);
  const rootId = await page.locator('.react-flow__node').getAttribute('data-id');
  if (rootId === null) throw new Error('created primary root has no public id');
  return { id, rootId };
}

async function child(page: Page, parentId: string, text: string) {
  await fit(page);
  await nodeAt(page, parentId).click();
  await page.keyboard.press('Tab');
  await expect(titleInput(page)).toBeFocused();
  const id = await page.locator('.react-flow__node.selected').getAttribute('data-id');
  if (id === null) throw new Error('created child has no public id');
  await titleInput(page).fill(text);
  await titleInput(page).press('Enter');
  return { id, text, children: [] };
}

async function position(page: Page, id: string) {
  return nodeAt(page, id).evaluate((element) => {
    const matrix = new DOMMatrixReadOnly((element as HTMLElement).style.transform);
    return { x: matrix.e, y: matrix.f };
  });
}

async function createAliceMap(page: Page): Promise<MindMap> {
  await page.clock.setFixedTime(new Date(NOW));
  const { id, rootId } = await createMap(page);
  const children = [];
  for (const text of CHILDREN) children.push(await child(page, rootId, text));
  const floating = await child(page, rootId, '浮动的想法');
  await fit(page);
  const pane = page.locator('.react-flow__pane');
  const emptyPoint = await pane.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const point = { x: 120, y: box.height - 120 };
    if (document.elementFromPoint(box.x + point.x, box.y + point.y) !== element) {
      throw new Error('floating-root destination is not empty canvas');
    }
    return point;
  });
  await nodeAt(page, floating.id).dragTo(pane, { targetPosition: emptyPoint });
  await expect
    .poll(async () => (await readRecord(page, id)) as object)
    .toMatchObject({
      map: {
        roots: [
          { id: rootId, children },
          { ...floating, position: { x: expect.any(Number), y: expect.any(Number) } },
        ],
      },
    });
  const saved = (await readRecord(page, id)) as { map: MindMap };
  const savedPosition = saved.map.roots[1]?.position;
  if (savedPosition === undefined) throw new Error('floating root has no saved position');
  expect(Number.isFinite(savedPosition.x)).toBe(true);
  expect(Number.isFinite(savedPosition.y)).toBe(true);
  expect(savedPosition).not.toEqual({ x: 0, y: 0 });
  const map: MindMap = {
    id,
    title: '新导图',
    createdAt: NOW,
    updatedAt: NOW,
    roots: [
      { id: rootId, text: '新导图', children },
      { ...floating, position: savedPosition },
    ],
  };
  expect(await readRecord(page, id)).toStrictEqual(envelopeOf(map).value);
  return map;
}

async function expectMapUi(page: Page, map: MindMap) {
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  await expect(page.getByTestId('editor-title')).toHaveText(map.title);
  await fit(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  const [root, floating] = map.roots;
  if (!root || !floating) throw new Error('acceptance map requires two roots');
  await expect(
    nodeAt(page, root.id).getByRole('button', { name: root.text, exact: true }),
  ).toBeVisible();
  const ys: number[] = [];
  for (const child of root.children) {
    await expect(
      nodeAt(page, child.id).getByRole('button', { name: child.text, exact: true }),
    ).toBeVisible();
    ys.push((await position(page, child.id)).y);
    await expect(page.locator(`.react-flow__edge[data-id="${child.id}"]`)).toHaveCount(1);
  }
  const [top, middle, bottom] = ys;
  if (middle === undefined || bottom === undefined) throw new Error('three children required');
  expect(top).toBeLessThan(middle);
  expect(middle).toBeLessThan(bottom);
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await expect(
    nodeAt(page, floating.id).getByRole('button', { name: floating.text, exact: true }),
  ).toBeVisible();
  const savedPosition = floating.position;
  if (savedPosition === undefined) throw new Error('floating root requires a position');
  await expect(async () => {
    const rendered = await position(page, floating.id);
    expect(rendered.x).toBeCloseTo(savedPosition.x, 3);
    expect(rendered.y).toBeCloseTo(savedPosition.y, 3);
  }).toPass();
}

async function rename(page: Page, id: string, text: string) {
  await fit(page);
  await nodeAt(page, id).dblclick();
  await expect(titleInput(page)).toBeFocused();
  await titleInput(page).fill(text);
  await titleInput(page).press('Enter');
  await expect(nodeAt(page, id).getByRole('button', { name: text, exact: true })).toBeVisible();
}

async function notFound(page: Page, id: string, evidence: string) {
  const response = mapResponse(page, id, 'GET');
  await page.goto(`/maps/${id}`);
  expect((await response).status()).toBe(404);
  await expect(page.getByText('找不到这张导图', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回导图列表' })).toHaveAttribute('href', '/');
  await expect(page.getByTestId('map-editor-ready')).toHaveCount(0);
  await screenshot(page, evidence);
}

test('M2 acceptance — two devices, pending-edit recovery and owner-only maps', async ({
  browser,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('Missing Playwright baseURL');
  mkdirSync(EVIDENCE, { recursive: true });
  const contextA = await browser.newContext({ baseURL });
  const contextB = await browser.newContext({ baseURL });
  const collectors: (() => Promise<string[]>)[] = [];
  const observe = (page: Page, declarations: readonly ExpectedResponse[] = []) => {
    const collector = collectExpectedResponses(page, declarations);
    collectors.push(() => collector.noise());
  };
  const newPage = async (
    context: BrowserContext,
    declarations: readonly ExpectedResponse[] = [],
  ) => {
    const page = await context.newPage();
    observe(page, declarations);
    return page;
  };
  try {
    const alice = `alice-${randomUUID()}`;
    const aliceLibrary = await newPage(contextA);
    await aliceLibrary.goto('/register');
    await authenticate(aliceLibrary, alice, '注册');
    const map = await createAliceMap(aliceLibrary);
    await aliceLibrary.goto('/');
    const editor = await newPage(contextA, [{ url: `/api/maps/${map.id}`, status: 401 }]);
    await editor.clock.setFixedTime(new Date(NOW));
    await editor.goto(`/maps/${map.id}`);
    await expectMapUi(editor, map);

    const deviceB = await newPage(contextB);
    await deviceB.goto('/login');
    await authenticate(deviceB, alice);
    await expect(deviceB.getByRole('listitem').getByRole('link')).toHaveText([map.title]);
    await expect(deviceB.getByRole('link', { name: map.title, exact: true })).toHaveAttribute(
      'href',
      `/maps/${map.id}`,
    );
    await deviceB.getByRole('link', { name: map.title, exact: true }).click();
    await expectMapUi(deviceB, map);
    expect(await readRecord(deviceB, map.id)).toStrictEqual(envelopeOf(map).value);
    await screenshot(deviceB, 'second-device');
    await deviceB.goto('/');

    const document = await editor.evaluateHandle(() => window.document);
    await signOut(aliceLibrary);
    const first = map.roots[0]?.children[0];
    const second = map.roots[0]?.children[1];
    if (!first || !second) throw new Error('recovery requires two distinct children');
    const denied = mapResponse(editor, map.id, 'PUT');
    await rename(editor, first.id, '登录前保留的修改');
    expect((await denied).status()).toBe(401);
    const sessionNotice = editor.getByText('登录已过期，请在新标签页重新登录后继续编辑', {
      exact: true,
    });
    await expect(sessionNotice).toBeVisible();
    expect(await readRecord(deviceB, map.id)).toStrictEqual(envelopeOf(map).value);
    const link = editor.getByRole('link', { name: '重新登录', exact: true });
    await expect(link).toHaveAttribute('href', '/login?next=%2F');
    await expect(link).toHaveAttribute('target', '_blank');
    contextA.once('page', (page) => {
      observe(page);
    });
    const popup = contextA.waitForEvent('page');
    await link.click();
    const login = await popup;
    await expect(login).toHaveURL('/login?next=%2F');
    await authenticate(login, alice);
    await expect(login.getByTestId('map-editor-ready')).toHaveCount(0);
    await screenshot(login, 'relogin-library');
    expect(await document.evaluate((original) => original === window.document)).toBe(true);
    await expect(editor).toHaveURL(`/maps/${map.id}`);
    const saved = mapResponse(editor, map.id, 'PUT');
    await rename(editor, second.id, '登录后继续的修改');
    expect((await saved).status()).toBe(204);
    await expect(sessionNotice).toHaveCount(0);
    await expect(link).toHaveCount(0);
    expect(await document.evaluate((original) => original === window.document)).toBe(true);
    first.text = '登录前保留的修改';
    second.text = '登录后继续的修改';
    const recovered = envelopeOf(map).value;
    expect(await readRecord(editor, map.id)).toStrictEqual(recovered);
    await editor.keyboard.press('Escape');
    await expectMapUi(editor, map);
    await screenshot(editor, 'relogin-recovered');
    await document.dispose();
    await editor.reload();
    await expectMapUi(editor, map);

    await signOut(deviceB);
    const bob = await newPage(contextB, [{ url: `/api/maps/${map.id}`, status: 404 }]);
    await bob.goto('/register');
    await authenticate(bob, `bob-${randomUUID()}`, '注册');
    const own = await createMap(bob);
    expect(own.id).not.toBe(map.id);
    await bob.goto('/');
    await bob.getByRole('button', { name: '重命名 新导图', exact: true }).click();
    await bob.getByRole('textbox', { name: '标题', exact: true }).fill('Bob 的私有导图');
    await bob.getByRole('button', { name: '保存', exact: true }).click();
    await expect(bob.getByRole('listitem').getByRole('link')).toHaveText(['Bob 的私有导图']);
    await expect(bob.getByRole('link', { name: 'Bob 的私有导图', exact: true })).toHaveAttribute(
      'href',
      `/maps/${own.id}`,
    );
    await expect(bob.locator(`a[href="/maps/${map.id}"]`)).toHaveCount(0);
    await screenshot(bob, 'bob-library');
    await login.reload();
    await expect(login.getByRole('listitem').getByRole('link')).toHaveText([map.title]);
    await expect(login.locator(`a[href="/maps/${own.id}"]`)).toHaveCount(0);
    await notFound(bob, map.id, 'bob-not-found');
    expect(await readRecord(editor, map.id)).toStrictEqual(recovered);
    await bob.getByRole('link', { name: '返回导图列表' }).click();
    await expect(bob).toHaveURL('/');
    await signOut(bob);

    const admin = await newPage(contextB, [{ url: `/api/maps/${map.id}`, status: 404 }]);
    await admin.goto('/login');
    await authenticate(admin, E2E_ADMIN_USERNAME, '登录', E2E_ADMIN_PASSWORD);
    const session = await admin.request.get('/api/auth/session');
    expect(session.status()).toBe(200);
    expect(await session.json()).toEqual({ username: E2E_ADMIN_USERNAME, isAdmin: true });
    await notFound(admin, map.id, 'admin-not-found');
    expect(await readRecord(editor, map.id)).toStrictEqual(recovered);
    for (const noise of collectors) expect(await noise()).toEqual([]);
  } finally {
    await contextB.close();
    await contextA.close();
  }
});
