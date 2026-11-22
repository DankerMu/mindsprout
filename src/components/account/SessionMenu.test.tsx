import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { heldResult } from '../../../tests/support/map-library';
import { SessionMenu } from './SessionMenu';
import { SessionNavigationScope } from './session-navigation';

failOnConsoleNoise();
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    bfcacheId: 'session-menu',
  };
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('fetch', fetch);
  const menu = (
    <StrictMode>
      <AppRouterContext value={router}>
        <SessionNavigationScope>
          <SessionMenu />
        </SessionNavigationScope>
      </AppRouterContext>
    </StrictMode>
  );
  return { fetch, router, menu };
}

it('loads once per mount and delivers the username to the live StrictMode effect', async () => {
  const { fetch, menu } = setup();
  const response = heldResult<Response>();
  fetch.mockReturnValue(response.promise);
  const view = render(menu);
  expect(view.container.innerHTML).toBe('');
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/auth/session');
  await act(async () => {
    response.resolve(Response.json({ username: ' Alice ', isAdmin: false }));
    await response.promise;
  });
  expect(screen.getByTestId('session-username').textContent).toBe(' Alice ');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([true, false])('shows admin navigation only for an administrator: %s', async (isAdmin) => {
  const { fetch, menu } = setup();
  fetch.mockResolvedValue(Response.json({ username: 'alice', isAdmin }));
  render(menu);
  expect((await screen.findByTestId('session-username')).textContent).toBe('alice');
  expect(screen.queryByRole('link', { name: '管理后台' })?.getAttribute('href') ?? null).toBe(
    isAdmin ? '/admin' : null,
  );
  expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
  for (const role of ['heading', 'listitem', 'status']) expect(screen.queryByRole(role)).toBeNull();
});

it('does no server-render work and loads a fresh identity after remount', async () => {
  const { fetch, menu } = setup();
  expect(renderToString(menu)).toBe('');
  expect(fetch).not.toHaveBeenCalled();
  const old = heldResult<Response>();
  fetch.mockReturnValueOnce(old.promise);
  const first = render(menu);
  first.unmount();
  fetch.mockResolvedValueOnce(Response.json({ username: 'bob', isAdmin: false }));
  render(menu);
  expect((await screen.findByTestId('session-username')).textContent).toBe('bob');
  await act(async () => {
    old.resolve(Response.json({ username: 'alice', isAdmin: true }));
    await old.promise;
  });
  expect(screen.getByTestId('session-username').textContent).toBe('bob');
  expect(fetch.mock.calls).toEqual([['/api/auth/session'], ['/api/auth/session']]);
});

it.each(['401', 'network', 'malformed'])('hides an unavailable session: %s', async (failure) => {
  const { fetch, router, menu } = setup();
  if (failure === 'network') fetch.mockRejectedValue(new TypeError('offline'));
  else fetch.mockResolvedValue(new Response('not JSON', { status: failure === '401' ? 401 : 200 }));
  const view = render(menu);
  await act(async () => {
    await Promise.resolve();
  });
  expect(view.container.innerHTML).toBe('');
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/auth/session');
  expect(router.push).not.toHaveBeenCalled();
});

it.each(['ok', 'non-ok', 'network'])('signs out only on success: %s', async (result) => {
  const { fetch, router, menu } = setup();
  fetch.mockResolvedValueOnce(Response.json({ username: 'alice', isAdmin: false }));
  render(menu);
  await screen.findByTestId('session-username');
  if (result === 'network') fetch.mockRejectedValueOnce(new TypeError('offline'));
  else fetch.mockResolvedValueOnce(new Response(null, { status: result === 'ok' ? 204 : 500 }));
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
  if (result === 'ok') {
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledExactlyOnceWith('/login');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  } else {
    expect((await screen.findByRole('alert')).textContent).toBe('请求失败，请重试');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-username').textContent).toBe('alice');
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
  }
  expect(fetch.mock.calls).toEqual([
    ['/api/auth/session'],
    [
      '/api/auth/logout',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
  ]);
  expect(screen.queryByRole('status')).toBeNull();
});
