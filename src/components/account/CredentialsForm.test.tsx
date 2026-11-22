import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { heldResult } from '../../../tests/support/map-library';
import { CredentialsForm } from './CredentialsForm';
import { SessionNavigationScope, useSessionNavigation } from './session-navigation';

failOnConsoleNoise();
afterEach(() => vi.unstubAllGlobals());

function setup(
  mode: 'login' | 'register',
  next: string | null = null,
  earlyInput?: { label: string; value: string },
) {
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
  const form = (
    <AppRouterContext value={router}>
      <SessionNavigationScope>
        <CredentialsForm mode={mode} next={next} />
      </SessionNavigationScope>
    </AppRouterContext>
  );
  if (earlyInput) {
    const container = document.createElement('div');
    container.innerHTML = renderToString(form);
    document.body.append(container);
    within(container).getByLabelText<HTMLInputElement>(earlyInput.label).value = earlyInput.value;
    render(form, { container, hydrate: true });
    expect(within(container).getByLabelText<HTMLInputElement>(earlyInput.label).value).toBe(
      earlyInput.value,
    );
  } else {
    render(form);
  }
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
  const [otherPath, otherLabel] = mode === 'login' ? ['/register', '注册'] : ['/login', '登录'];

  it.each([
    [null, ''],
    ['/maps/abc', '?next=%2Fmaps%2Fabc'],
    ['/maps/abc?label=a%20b&view=tree', '?next=%2Fmaps%2Fabc%3Flabel%3Da%2520b%26view%3Dtree'],
    ['', '?next=%2F'],
    ['//evil.example', '?next=%2F'],
    ['https://evil.example', '?next=%2F'],
    ['/\\evil', '?next=%2F'],
    ['/\n/evil.example/x', '?next=%2F'],
    ['/\r/evil.example/x', '?next=%2F'],
    ['/\t\\evil.example/x', '?next=%2F'],
  ])('links to the other form without submitting when next is %j', (next, query) => {
    const { fetch, router } = setup(mode, next);
    const link = screen.getByRole('link', { name: otherLabel });
    expect(link.getAttribute('href')).toBe(`${otherPath}${query}`);
    expect(fetch).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    ['用户名', ' Alice ', '密码', ' pw '],
    ['密码', ' pw ', '用户名', ' Alice '],
  ])(
    'retains pre-hydration %s when the other credential changes and submits exact values',
    async (earlyLabel, earlyValue, laterLabel, laterValue) => {
      const { fetch, router, button } = setup(mode, '/maps/abc?x=1', {
        label: earlyLabel,
        value: earlyValue,
      });
      const response = heldResult<Response>();
      fetch.mockReturnValueOnce(response.promise);
      fireEvent.change(screen.getByLabelText(laterLabel), { target: { value: laterValue } });
      expect(screen.getByLabelText<HTMLInputElement>(earlyLabel).value).toBe(earlyValue);
      fireEvent.click(button);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"username":" Alice ","password":" pw "}',
      });
      expect(screen.getByLabelText<HTMLInputElement>('用户名').value).toBe(' Alice ');
      expect(screen.getByLabelText<HTMLInputElement>('密码').value).toBe(' pw ');
      await act(() => {
        response.resolve(new Response(null, { status: mode === 'login' ? 200 : 201 }));
        return response.promise;
      });
      expect(router.push).toHaveBeenCalledExactlyOnceWith('/maps/abc?x=1');
    },
  );

  it.each([
    ['refusal', '请输入用户名和密码'],
    ['network failure', '请求失败，请重试'],
  ])('resubmits pre-hydration credentials unchanged after %s', async (failure, message) => {
    const { fetch, router, button } = setup(mode, null, { label: '密码', value: ' pw ' });
    if (failure === 'refusal') {
      fetch.mockResolvedValueOnce(new Response(null, { status: 400 }));
    } else {
      fetch.mockRejectedValueOnce(new TypeError('offline'));
    }
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: ' Alice ' } });
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.getByLabelText<HTMLInputElement>('用户名').value).toBe(' Alice ');
    expect(screen.getByLabelText<HTMLInputElement>('密码').value).toBe(' pw ');
    expect(router.push).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    fetch.mockResolvedValueOnce(new Response(null, { status: mode === 'login' ? 200 : 201 }));
    fireEvent.click(button);
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledExactlyOnceWith('/');
    });
    expect(fetch.mock.calls).toEqual([
      [
        `/api/auth/${mode}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"username":" Alice ","password":" pw "}',
        },
      ],
      [
        `/api/auth/${mode}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"username":" Alice ","password":" pw "}',
        },
      ],
    ]);
  });

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

it.each(['login', 'register'] as const)(
  'activates the next navigation epoch before pushing after hydrated %s success',
  async (mode) => {
    const { result } = renderHook(useSessionNavigation, { wrapper: SessionNavigationScope });
    result.current.signOutStarted();
    const { fetch, router } = setup(mode);
    const publicEpoch = result.current.captureEpoch();
    const redirectAllowedOnPush = vi.fn();
    router.push.mockImplementation(() => {
      const navigation = result.current;
      redirectAllowedOnPush(navigation.canRedirectOnExpiry(navigation.captureEpoch()));
    });
    fetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    submit();
    await screen.findByRole('alert');
    expect(result.current.canRedirectOnExpiry(publicEpoch)).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(new Response(null, { status: mode === 'login' ? 200 : 201 }));
    submit();
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledExactlyOnceWith('/');
    });
    expect(redirectAllowedOnPush).toHaveBeenCalledExactlyOnceWith(true);
    expect(result.current.canRedirectOnExpiry(publicEpoch)).toBe(false);
  },
);
