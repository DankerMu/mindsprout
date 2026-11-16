import { act, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { heldResult } from '../../../tests/support/map-library';
import { AdminUserList } from './AdminUserList';

failOnConsoleNoise();
afterEach(() => vi.unstubAllGlobals());
const accounts = [
  { id: 'b', username: ' Bob ', createdAt: '2026-11-15T10:00:00.000Z', isAdmin: false },
  { id: 'a', username: 'owner', createdAt: '2026-11-14T09:00:00.000Z', isAdmin: true },
];

function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const assign = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('location', { assign });
  return { fetch, assign };
}

function expectNoAccounts() {
  expect(screen.queryByRole('listitem')).toBeNull();
  expect(screen.queryByText('owner')).toBeNull();
  expect(screen.queryByText('Bob')).toBeNull();
  expect(screen.queryByText('管理员')).toBeNull();
  expect(document.querySelector('time')).toBeNull();
}

it('loads only on the client and preserves exact API order, usernames, times and admin badge', async () => {
  const { fetch, assign } = setup();
  const response = heldResult<Response>();
  fetch.mockReturnValue(response.promise);
  expect(renderToString(<AdminUserList />)).toContain('正在读取用户列表');
  expect(fetch).not.toHaveBeenCalled();
  render(<AdminUserList />);
  expect(screen.getByRole('status').textContent).toBe('正在读取用户列表');
  expectNoAccounts();
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/users');
  await act(async () => {
    response.resolve(Response.json(accounts));
    await response.promise;
  });
  const rows = screen.getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  const [bob, owner] = rows;
  if (!bob || !owner) throw new Error('Missing account rows');
  expect(within(bob).getByText('Bob').textContent).toBe(' Bob ');
  expect(within(owner).getByText('owner').textContent).toBe('owner');
  expect(rows.map((row) => row.querySelector('time')?.textContent)).toEqual([
    '2026-11-15T10:00:00.000Z',
    '2026-11-14T09:00:00.000Z',
  ]);
  expect(rows.map((row) => row.querySelector('time')?.getAttribute('datetime'))).toEqual([
    '2026-11-15T10:00:00.000Z',
    '2026-11-14T09:00:00.000Z',
  ]);
  expect(within(bob).queryByText('管理员')).toBeNull();
  expect(within(owner).getByText('管理员')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(assign).not.toHaveBeenCalled();
});

it('refuses a regular user with a home link and no account data', async () => {
  const { fetch, assign } = setup();
  fetch.mockResolvedValue(Response.json(accounts, { status: 403 }));
  render(<AdminUserList />);
  expect(await screen.findByText('无权访问')).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe('/');
  expectNoAccounts();
  expect(assign).not.toHaveBeenCalled();
});

it('redirects a live expired session to the exact admin login target without account data', async () => {
  const { fetch, assign } = setup();
  fetch.mockResolvedValue(Response.json(accounts, { status: 401 }));
  render(<AdminUserList />);
  await waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/login?next=%2Fadmin');
  });
  expectNoAccounts();
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['500', '201', 'network', 'JSON'])(
  'shows no data or redirect on %s failure',
  async (failure) => {
    const { fetch, assign } = setup();
    if (failure === 'network') fetch.mockRejectedValue(new TypeError('offline'));
    else
      fetch.mockResolvedValue(
        new Response('not JSON', { status: failure === 'JSON' ? 200 : Number(failure) }),
      );
    render(<AdminUserList />);
    expect((await screen.findByRole('alert')).textContent).toBe('无法读取用户列表');
    expectNoAccounts();
    expect(assign).not.toHaveBeenCalled();
  },
);

it.each([200, 403, 500])(
  'discarded StrictMode responses cannot overwrite live %s state or redirect',
  async (status) => {
    const { fetch, assign } = setup();
    const discarded = heldResult<Response>();
    fetch
      .mockReturnValueOnce(discarded.promise)
      .mockResolvedValueOnce(Response.json(accounts, { status }));
    render(
      <StrictMode>
        <AdminUserList />
      </StrictMode>,
    );
    if (status === 200) await screen.findByText('owner');
    else await screen.findByText(status === 403 ? '无权访问' : '无法读取用户列表');
    const before = document.body.innerHTML;
    await act(async () => {
      discarded.resolve(Response.json(accounts, { status: 401 }));
      await discarded.promise;
    });
    expect(document.body.innerHTML).toBe(before);
    expect(assign).not.toHaveBeenCalled();
  },
);

it.each(['200', '403', 'network'])(
  'ignores discarded StrictMode %s after a live refusal',
  async (outcome) => {
    const { fetch, assign } = setup();
    const discarded = heldResult<Response>();
    fetch
      .mockReturnValueOnce(discarded.promise)
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    render(
      <StrictMode>
        <AdminUserList />
      </StrictMode>,
    );
    await screen.findByText('无权访问');
    await act(async () => {
      if (outcome === 'network') discarded.reject(new TypeError('offline'));
      else discarded.resolve(Response.json(accounts, { status: Number(outcome) }));
      await Promise.allSettled([discarded.promise]);
    });
    expect(screen.getByText('无权访问')).toBeTruthy();
    expectNoAccounts();
    expect(assign).not.toHaveBeenCalled();
  },
);

it.each(['success', 'failure'])(
  'discards pending JSON on unmount and loads fresh on remount: %s',
  async (outcome) => {
    const { fetch, assign } = setup();
    const json = heldResult<unknown>();
    const response = Response.json(accounts);
    const readJson = vi.spyOn(response, 'json').mockReturnValue(json.promise);
    fetch.mockResolvedValueOnce(response);
    const first = render(<AdminUserList />);
    await waitFor(() => {
      expect(readJson).toHaveBeenCalledOnce();
    });
    first.unmount();
    fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    render(<AdminUserList />);
    await screen.findByText('无权访问');
    await act(async () => {
      if (outcome === 'success') json.resolve(accounts);
      else json.reject(new SyntaxError('invalid JSON'));
      await Promise.allSettled([json.promise]);
    });
    expect(screen.getByText('无权访问')).toBeTruthy();
    expectNoAccounts();
    expect(assign).not.toHaveBeenCalled();
    expect(fetch.mock.calls).toEqual([['/api/admin/users'], ['/api/admin/users']]);
  },
);
