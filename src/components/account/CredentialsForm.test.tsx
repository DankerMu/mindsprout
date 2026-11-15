import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { heldResult } from '../../../tests/support/map-library';
import { CredentialsForm } from './CredentialsForm';

failOnConsoleNoise();
afterEach(() => vi.unstubAllGlobals());

function setup(mode: 'login' | 'register', next: string | null = null) {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    bfcacheId: 'account-auth',
  };
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('fetch', fetch);
  render(
    <AppRouterContext value={router}>
      <CredentialsForm mode={mode} next={next} />
    </AppRouterContext>,
  );
  expect(fetch).not.toHaveBeenCalled();
  const button = screen.getByRole<HTMLButtonElement>('button', {
    name: mode === 'login' ? '登录' : '注册',
  });
  return { fetch, router, button };
}

function submit(username = 'alice', password = 'pw') {
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button'));
}

describe.each(['login', 'register'] as const)('account-auth: %s', (mode) => {
  it.each([
    ['Taken username', 409, '用户名已被占用'],
    ['Wrong password or unknown user', 401, '用户名或密码错误'],
    ['Missing credentials', 400, '请输入用户名和密码'],
    ['Unexpected response', 500, '请求失败，请重试'],
    ['Non-success redirect', 302, '请求失败，请重试'],
  ] as const)('%s leaves the visitor on the form', async (_scenario, status, message) => {
    const { fetch, router, button } = setup(mode, '/maps/abc?x=1');
    fetch.mockResolvedValue(new Response(null, { status }));
    submit('', '');
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username":"","password":""}',
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it('shows network failure without navigating and allows another submission', async () => {
    const { fetch, router, button } = setup(mode);
    fetch.mockRejectedValueOnce(new TypeError('offline'));
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('请求失败，请重试');
    expect(router.push).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    submit();
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledExactlyOnceWith('/');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['/maps/abc?x=1', '/maps/abc?x=1'],
    ['//evil.example/x', '/'],
    ['https://evil.example', '/'],
    ['/\\evil', '/'],
    ['/\n/evil.example/x', '/'],
    ['/\r/evil.example/x', '/'],
    ['/\t\\evil.example/x', '/'],
    [null, '/'],
  ])('posts exact credentials and navigates safely from %s', async (next, expected) => {
    const { fetch, router, button } = setup(mode, next);
    fetch.mockResolvedValue(new Response(null, { status: mode === 'login' ? 200 : 201 }));
    submit(' Alice ', ' pw ');
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledExactlyOnceWith(expected);
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username":" Alice ","password":" pw "}',
    });
    expect(button.disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('prevents duplicate submissions while pending and restores readiness', async () => {
    const { fetch, router, button } = setup(mode);
    const response = heldResult<Response>();
    fetch.mockReturnValue(response.promise);
    submit();
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('提交中…');
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    await act(() => {
      response.resolve(new Response(null, { status: 400 }));
      return response.promise;
    });
    expect(screen.getByRole('alert').textContent).toBe('请输入用户名和密码');
    expect(router.push).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
