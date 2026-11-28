import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { MapFetch } from '../../../tests/support/map-fetch';
import { heldResult } from '../../../tests/support/map-library';
import { AdminUserList } from '../../components/account/AdminUserList';
import { CredentialsForm } from '../../components/account/CredentialsForm';
import { SessionMenu } from '../../components/account/SessionMenu';
import { MapLibraryClient } from '../MapLibraryClient';
import { StorageUnauthorizedError } from '../../contexts/map/domain/errors';
import type { GenerateSource } from '../../contexts/map/domain/generate-source';
import { HttpGenerateSource } from '../../contexts/map/infrastructure/ai/http-generate-source';
import { HttpMapRepository } from '../../contexts/map/infrastructure/persistence/http-map-repository';
import {
  MapRepositoryProvider,
  openSessionRepository,
  useMapRepository,
  type RepositoryState,
} from './MapRepositoryProvider';

failOnConsoleNoise();

afterEach(() => {
  document.cookie = 'mindsprout_session_binding=; Path=/; Max-Age=0';
  vi.unstubAllGlobals();
});

it('shares the HTTP repository promise and stored maps across replay and remount', async () => {
  const server = new MapFetch();
  vi.stubGlobal('fetch', server.fetch);
  server.authenticateAs('Alice');
  document.cookie = 'mindsprout_session_binding=QWxpY2U; Path=/';
  const seen: RepositoryState[] = [];
  function Probe() {
    const state = useMapRepository();
    seen.push(state);
    return <p>{state.status}</p>;
  }
  const tree = (
    <StrictMode>
      <MapRepositoryProvider>
        <Probe />
      </MapRepositoryProvider>
    </StrictMode>
  );
  expect(renderToString(tree)).toContain('opening');
  expect(server.requests).toEqual([]);
  const firstMount = render(tree);
  const promise = openSessionRepository();
  const session = await act(() => promise);
  expect(screen.getByText('ready')).toBeTruthy();
  expect(session.repository).toBeInstanceOf(HttpMapRepository);
  expect(server.requests).toEqual([]);
  const map = { ...mapOf(node('session-root')), id: 'session-map' };
  await session.repository.put(map);
  firstMount.unmount();
  render(tree);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByText('ready')).toBeTruthy();
  expect(openSessionRepository()).toBe(promise);
  expect(
    seen
      .filter((state) => state.status === 'ready')
      .every((state) => state.repository === session.repository),
  ).toBe(true);
  expect(await session.repository.get('session-map')).toStrictEqual(map);
  expect(server.requests.map(({ init }) => init?.method)).toEqual(['PUT', 'GET']);
});

// Runs one generation to its end over a stub that answers /api/ai/generate with a bare done frame.
async function drainGenerate(source: GenerateSource | undefined): Promise<void> {
  if (source === undefined) throw new Error('the session has no generate source');
  const signal = new AbortController().signal;
  for await (const op of source.generate({ topic: '主题', rootId: 'r' }, signal)) {
    throw new Error(`unexpected op ${op.op}`);
  }
}

it('rebinds the document repository only when the account binding changes', async () => {
  const server = new MapFetch();
  // MapFetch serves only map routes; the generate source's requests are recorded here.
  const generateHeaders: (string | null)[] = [];
  vi.stubGlobal('fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    if (input !== '/api/ai/generate') return server.fetch(input, init);
    generateHeaders.push(new Headers(init?.headers).get('x-mindsprout-session-binding'));
    return new Response('event: done\ndata: {}\n\n', { status: 200 });
  });
  document.cookie = 'mindsprout_session_binding=QWxpY2U; Path=/';
  const alicePromise = openSessionRepository();
  const alice = await alicePromise;
  expect(openSessionRepository()).toBe(alicePromise);
  document.cookie = 'mindsprout_session_binding=Qm9i; Path=/';
  server.authenticateAs('Bob');
  const bobPromise = openSessionRepository();
  const bob = await bobPromise;
  expect(bobPromise).not.toBe(alicePromise);
  expect(bob.repository).not.toBe(alice.repository);
  expect(openSessionRepository()).toBe(bobPromise);
  expect(server.requests).toEqual([]);
  await bob.repository.list();
  expect(new Headers(server.requests[0]?.init?.headers).get('x-mindsprout-session-binding')).toBe(
    'Qm9i',
  );
  expect(bob.generateSource).toBeInstanceOf(HttpGenerateSource);
  expect(bob.generateSource).not.toBe(alice.generateSource);
  await drainGenerate(bob.generateSource);
  expect(generateHeaders).toStrictEqual(['Qm9i']);
  document.cookie = 'mindsprout_session_binding=; Path=/; Max-Age=0';
  const unbound = await openSessionRepository();
  expect(unbound.generateSource).not.toBe(bob.generateSource);
  await drainGenerate(unbound.generateSource);
  expect(generateHeaders).toStrictEqual(['Qm9i', '']);
});

it('opens synchronously on account change in a mounted provider without exposing Alice state', async () => {
  const server = new MapFetch();
  vi.stubGlobal('fetch', server.fetch);
  const seen: RepositoryState[] = [];
  function Probe({ route }: { route: string }) {
    const state = useMapRepository();
    seen.push(state);
    return (
      <p>
        {route}:{state.status}
      </p>
    );
  }
  document.cookie = 'mindsprout_session_binding=QWxpY2U; Path=/';
  const view = render(
    <MapRepositoryProvider>
      <Probe route="editor" />
    </MapRepositoryProvider>,
  );
  await act(() => openSessionRepository());
  const alice = seen.at(-1);
  view.rerender(
    <MapRepositoryProvider>
      <Probe route="library" />
    </MapRepositoryProvider>,
  );
  expect(seen.at(-1)).toBe(alice);
  seen.length = 0;
  document.cookie = 'mindsprout_session_binding=Qm9i; Path=/';
  server.authenticateAs('Bob');
  view.rerender(
    <MapRepositoryProvider>
      <Probe route="bob" />
    </MapRepositoryProvider>,
  );
  const first = seen[0];
  await act(() => openSessionRepository());
  expect(first).toEqual({ status: 'opening' });
  expect(seen).not.toContain(alice);
  expect(seen.at(-1)).toMatchObject({ status: 'ready' });
  expect(screen.getByText('bob:ready')).toBeTruthy();
});

it('rejects credential-only legacy queued saves after Bob signs in and lets Bob continue', async () => {
  const server = new MapFetch();
  server.authenticateAs('Alice');
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
    if (++started === 1) await held;
    return server.fetch(...args);
  });
  const promise = openSessionRepository();
  document.cookie = 'mindsprout_session_binding=; Path=/';
  expect(openSessionRepository()).toBe(promise);
  const { repository } = await promise;
  const predecessor = { ...mapOf(node('legacy-first')), id: 'legacy-predecessor' };
  const sensitive = {
    ...mapOf(node('legacy-sensitive')),
    id: 'alice-legacy-private',
    title: 'Alice confidential legacy plan',
  };
  const outcomes = Promise.allSettled([repository.put(predecessor), repository.put(sensitive)]);
  expect(started).toBe(1);
  server.authenticateAs('Bob');
  release();
  const settled = await outcomes;
  const bob = new HttpMapRepository(server.fetch, 'Qm9i');
  const leaked = await bob.get(sensitive.id);
  expect
    .soft({
      outcomes: settled.map((result): unknown =>
        result.status === 'rejected' ? result.reason : result.status,
      ),
      bobRecord: leaked,
    })
    .toEqual({
      outcomes: [expect.any(StorageUnauthorizedError), expect.any(StorageUnauthorizedError)],
      bobRecord: undefined,
    });
  expect(await bob.get(predecessor.id)).toBeUndefined();
  expect(
    server.requests
      .slice(0, 2)
      .map(({ init }) => new Headers(init?.headers).get('x-mindsprout-session-binding')),
  ).toEqual(['', '']);
  document.cookie = 'mindsprout_session_binding=Qm9i; Path=/';
  const bobPromise = openSessionRepository();
  expect(bobPromise).not.toBe(promise);
  const own = { ...mapOf(node('bob-own')), id: 'bob-own', title: 'Bob own map' };
  const bobSession = await bobPromise;
  await bobSession.repository.put(own);
  expect(await bobSession.repository.get(own.id)).toStrictEqual(own);
});

function navigationHarness() {
  const list = heldResult<Response>();
  const afterRemount = heldResult<Response>();
  const logout = heldResult<Response>();
  const binding = crypto.randomUUID();
  const denied = () => new Response(null, { status: 401 });
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (url === '/api/auth/session') return Response.json({ username: 'Alice', isAdmin: true });
    if (url === '/api/auth/logout') return logout.promise;
    if (url === '/api/auth/login' || url === '/api/auth/register') return new Response();
    if (url === '/api/maps') {
      const requestBinding = new Headers(init?.headers).get('x-mindsprout-session-binding');
      return requestBinding === binding ? list.promise : afterRemount.promise;
    }
    if (url === '/api/admin/users') return list.promise;
    if (url === '/api/admin/users/alice/password-reset') return afterRemount.promise;
    throw new Error('Unexpected fetch in session navigation test');
  });
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    bfcacheId: 'session-navigation',
  };
  const assign = vi.fn();
  const replace = vi.fn();
  vi.stubGlobal('location', { pathname: '/', assign, replace });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('confirm', () => true);
  document.cookie = `mindsprout_session_binding=${binding}; Path=/`;
  function tree(
    path: string,
    {
      admin = false,
      retainAdmin = false,
      providerKey,
    }: { admin?: boolean; retainAdmin?: boolean; providerKey?: string } = {},
  ) {
    return (
      <StrictMode>
        <AppRouterContext value={router}>
          <PathnameContext value={path}>
            <MapRepositoryProvider key={providerKey}>
              {retainAdmin && <AdminUserList />}
              {path === '/login' || path === '/register' ? (
                <CredentialsForm mode={path === '/login' ? 'login' : 'register'} next="/" />
              ) : (
                <>
                  <SessionMenu />
                  {admin ? !retainAdmin && <AdminUserList /> : <MapLibraryClient />}
                </>
              )}
            </MapRepositoryProvider>
          </PathnameContext>
        </AppRouterContext>
      </StrictMode>
    );
  }
  async function signOut() {
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));
    await act(async () => {
      logout.resolve(new Response(null, { status: 204 }));
      await logout.promise;
    });
    expect(router.push).toHaveBeenCalledExactlyOnceWith('/login');
  }
  return { list, afterRemount, logout, denied, fetch, router, assign, replace, tree, signOut };
}

it.each(['library list', 'remounted library list', 'admin list', 'admin reset'])(
  'keeps exact /login when a live %s returns 401 during sign-out navigation',
  async (surface) => {
    const t = navigationHarness();
    const admin = surface.startsWith('admin');
    const path = admin ? '/admin' : '/';
    const view = render(t.tree(path, { admin }));
    await act(() => openSessionRepository());
    const listUrl = admin ? '/api/admin/users' : '/api/maps';
    if (surface === 'admin reset') {
      await act(async () => {
        t.list.resolve(
          Response.json([
            { id: 'alice', username: 'Alice', createdAt: '2026-11-22T00:00:00Z', isAdmin: true },
          ]),
        );
        await t.list.promise;
      });
      fireEvent.click(await screen.findByRole('button', { name: '重置密码 Alice' }));
      expect(t.fetch.mock.calls.at(-1)?.[0]).toBe('/api/admin/users/alice/password-reset');
    } else {
      await waitFor(() => {
        expect(t.fetch.mock.calls.some(([url]) => url === listUrl)).toBe(true);
      });
    }
    await t.signOut();
    if (surface === 'remounted library list') {
      document.cookie = 'mindsprout_session_binding=; Path=/; Max-Age=0';
      view.rerender(t.tree(path));
      await waitFor(() => {
        const reads = t.fetch.mock.calls.filter(([url]) => url === listUrl);
        expect(new Headers(reads.at(-1)?.[1]?.headers).get('x-mindsprout-session-binding')).toBe(
          '',
        );
      });
    }
    await act(async () => {
      const pending =
        surface === 'library list' || surface === 'admin list' ? t.list : t.afterRemount;
      pending.resolve(t.denied());
      await pending.promise;
    });
    expect(t.assign).not.toHaveBeenCalled();
    view.rerender(t.tree('/login'));
    expect(screen.getByTestId('login-ready')).toBeTruthy();
    view.rerender(t.tree('/'));
    await act(() => openSessionRepository());
  },
);

it.each([
  ['/maps/seed', '/'],
  ['/', '/admin'],
  ['/admin', '/'],
])('reissues exact sign-out when %s commits %s, not on same-path remount', async (from, to) => {
  const t = navigationHarness();
  const view = render(t.tree(from));
  await t.signOut();

  document.cookie = 'mindsprout_session_binding=; Path=/; Max-Age=0';
  const providerKey = 'remounted';
  view.rerender(t.tree(from, { providerKey }));
  await act(() => openSessionRepository());
  expect(t.replace).not.toHaveBeenCalled();
  expect(t.router.push).toHaveBeenCalledExactlyOnceWith('/login');

  view.rerender(t.tree(to, { admin: to === '/admin', providerKey }));
  expect(t.replace).toHaveBeenCalledExactlyOnceWith('/login');
  view.rerender(t.tree(to, { admin: to === '/admin', providerKey }));
  expect(t.replace).toHaveBeenCalledTimes(1);
  await act(async () => {
    const pending = to === '/admin' ? t.list : t.afterRemount;
    pending.resolve(t.denied());
    await pending.promise;
  });
  expect(t.assign).not.toHaveBeenCalled();
  view.rerender(t.tree('/login', { providerKey }));
  view.rerender(t.tree('/', { providerKey }));
  await act(() => openSessionRepository());
  expect(t.replace).toHaveBeenCalledTimes(1);
});

it.each(['/login', '/register', 'route boundary'])(
  'retires pre-sign-out loads and restores later genuine expiry through %s',
  async (entry) => {
    const t = navigationHarness();
    const view = render(t.tree('/admin', { retainAdmin: true }));
    await t.signOut();
    view.rerender(t.tree(entry === 'route boundary' ? '/login' : entry, { retainAdmin: true }));
    if (entry !== 'route boundary') {
      fireEvent.click(screen.getByRole('button', { name: entry === '/login' ? '登录' : '注册' }));
      await waitFor(() => {
        expect(t.router.push.mock.calls).toEqual([['/login'], ['/']]);
      });
    }
    view.rerender(t.tree('/', { retainAdmin: true }));
    await act(async () => {
      t.list.resolve(t.denied());
      await t.list.promise;
    });
    expect(t.assign.mock.calls).toEqual([['/login?next=%2F']]);
  },
);

it.each(['server failure', 'network failure'])(
  'lets a live list expiry redirect after sign-out %s',
  async (failure) => {
    const t = navigationHarness();
    render(t.tree('/'));
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));
    await act(async () => {
      if (failure === 'network failure') t.logout.reject(new TypeError('offline'));
      else t.logout.resolve(new Response(null, { status: 500 }));
      await t.logout.promise.catch(() => undefined);
    });
    expect(screen.getByRole('alert').textContent).toBe('请求失败，请重试');
    expect(t.router.push).not.toHaveBeenCalled();
    await act(async () => {
      t.list.resolve(t.denied());
      await t.list.promise;
    });
    expect(t.assign).toHaveBeenCalledExactlyOnceWith('/login?next=%2F');
  },
);
