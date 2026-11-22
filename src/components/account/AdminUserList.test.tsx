import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  expect(within(bob).getByRole('button', { name: '重置密码 Bob' })).toBeTruthy();
  expect(within(owner).getByRole('button', { name: '重置密码 owner' })).toBeTruthy();
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

async function setupReset() {
  const mocks = setup();
  const confirm = vi.fn(() => true);
  vi.stubGlobal('confirm', confirm);
  mocks.fetch.mockResolvedValueOnce(Response.json(accounts));
  const view = render(<AdminUserList />);
  const owner = await screen.findByRole<HTMLButtonElement>('button', { name: '重置密码 owner' });
  const bob = screen.getByRole<HTMLButtonElement>('button', { name: '重置密码 Bob' });
  return { ...mocks, ...view, confirm, buttons: [bob, owner], bob, owner };
}

it.each([
  ['重置密码 Bob', '确定重置  Bob  的密码吗？重置后该用户的所有登录将失效'],
  ['重置密码 owner', '确定重置 owner 的密码吗？重置后该用户的所有登录将失效'],
])(
  'cancels %s after naming the selected account without sending a reset request',
  async (name, message) => {
    const { fetch } = setup();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    fetch.mockResolvedValueOnce(Response.json(accounts));
    render(<AdminUserList />);

    fireEvent.click(await screen.findByRole('button', { name }));
    expect(confirm).toHaveBeenCalledExactlyOnceWith(message);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/users');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);

it('Temporary password is shown once; pending and open dialogs block every row', async () => {
  const { fetch, confirm, bob, owner, buttons, unmount } = await setupReset();
  const response = heldResult<Response>();
  fetch.mockReturnValueOnce(response.promise);
  act(() => {
    bob.click();
    bob.click();
    owner.click();
  });
  expect(confirm).toHaveBeenCalledExactlyOnceWith(
    '确定重置  Bob  的密码吗？重置后该用户的所有登录将失效',
  );
  expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/users/b/password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(buttons.every((button) => button.disabled)).toBe(true);
  expect(screen.getByRole('status').textContent).toBe('正在重置密码');
  await act(async () => {
    response.resolve(Response.json({ temporaryPassword: 'test-only-secret' }));
    await response.promise;
  });
  const dialog = screen.getByRole('dialog', { name: '临时密码' });
  expect(
    within(dialog).getByText('临时密码仅显示一次，请选中并复制保存；关闭后将不再显示。'),
  ).toBeTruthy();
  const input = within(dialog).getByRole<HTMLInputElement>('textbox', { name: '临时密码' });
  expect(input.value === 'test-only-secret').toBe(true);
  expect(input.readOnly).toBe(true);
  expect(document.activeElement === input).toBe(true);
  expect(fireEvent.mouseUp(input)).toBe(false);
  fireEvent.click(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd === input.value.length).toBe(true);
  fireEvent.click(owner);
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.innerHTML.includes('test-only-secret')).toBe(false);
  expect(buttons.every((button) => !button.disabled)).toBe(true);
  await waitFor(() => {
    expect(document.activeElement === bob).toBe(true);
  });
  fetch.mockResolvedValueOnce(Response.json({ temporaryPassword: 'another-test-secret' }));
  fireEvent.click(owner);
  await screen.findByRole('dialog');
  expect(fetch).toHaveBeenNthCalledWith(3, '/api/admin/users/a/password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(document.body.innerHTML.includes('test-only-secret')).toBe(false);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  unmount();
  fetch.mockResolvedValueOnce(Response.json(accounts));
  render(<AdminUserList />);
  await screen.findByText('owner');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.innerHTML.includes('another-test-secret')).toBe(false);
});

it('reset401 clears accounts and secret and uses the exact admin document redirect', async () => {
  const { fetch, assign, bob } = await setupReset();
  fetch.mockResolvedValueOnce(Response.json({ temporaryPassword: 'test-only-secret' }));
  fireEvent.click(bob);
  fireEvent.click(await screen.findByRole('button', { name: '关闭' }));
  fetch.mockResolvedValueOnce(
    Response.json({ temporaryPassword: 'must-not-show' }, { status: 401 }),
  );
  fireEvent.click(bob);
  await waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/login?next=%2Fadmin');
  });
  expectNoAccounts();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.innerHTML.includes('test-only-secret')).toBe(false);
  expect(document.body.innerHTML.includes('must-not-show')).toBe(false);
});

it.each(['403', '404', '500', '201', 'network', 'JSON'])(
  'reset %s failure keeps the accounts without redirecting or inventing a secret',
  async (failure) => {
    const { fetch, assign, bob, buttons } = await setupReset();
    if (failure === 'network') fetch.mockRejectedValueOnce(new TypeError('offline'));
    else
      fetch.mockResolvedValueOnce(
        new Response('not JSON', {
          status: failure === 'JSON' ? 200 : Number(failure),
        }),
      );
    fireEvent.click(bob);
    expect((await screen.findByRole('alert')).textContent).toBe('无法重置密码，请重试');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('owner')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(assign).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(Response.json({ temporaryPassword: 'retry-test-secret' }));
    fireEvent.click(bob);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it.each(['401', 'network', 'JSON'])(
  'ignores reset %s settlement after unmount',
  async (outcome) => {
    const { fetch, assign, bob, unmount } = await setupReset();
    const response = heldResult<Response>();
    const json = heldResult<unknown>();
    const success = Response.json({});
    const readJson = vi.spyOn(success, 'json').mockReturnValue(json.promise);
    fetch.mockReturnValueOnce(response.promise);
    fireEvent.click(bob);
    if (outcome === 'JSON') {
      await act(async () => {
        response.resolve(success);
        await response.promise;
      });
      await waitFor(() => {
        expect(readJson).toHaveBeenCalledOnce();
      });
    }
    unmount();
    await act(async () => {
      if (outcome === 'network') response.reject(new TypeError('offline'));
      else if (outcome === 'JSON') json.resolve({ temporaryPassword: 'discarded-test-secret' });
      else response.resolve(new Response(null, { status: 401 }));
      await Promise.allSettled([response.promise]);
    });
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);
