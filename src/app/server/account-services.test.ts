import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/contexts/account/domain/account';

const mocks = vi.hoisted(() => ({
  sql: {},
  postgres: vi.fn(),
  users: vi.fn(),
  sessions: vi.fn(),
  hasher: vi.fn(),
  tokens: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/contexts/account/infrastructure/postgres', () => ({
  PostgresUserRepository: mocks.users,
  PostgresSessionRepository: mocks.sessions,
}));
vi.mock('@/contexts/account/infrastructure/crypto', () => ({
  ScryptPasswordHasher: mocks.hasher,
  CryptoTokenSource: mocks.tokens,
}));

const user: User = {
  id: 'user-1',
  username: 'Alice',
  isAdmin: false,
  createdAt: '2026-11-01T00:00:00.000Z',
};
const now = new Date('2026-11-14T00:00:00.000Z');
const token = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

function request(cookie?: string): Request {
  return new Request('http://localhost/api/auth/session', {
    headers: cookie === undefined ? {} : { cookie },
  });
}

// Dynamic imports isolate the lazy module singleton after vi.resetModules().
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgres://app:local@localhost/accounts');
  vi.stubEnv('NODE_ENV', 'development');
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.postgres.mockReturnValue(mocks.sql);
  mocks.users.mockImplementation(function () {
    return {};
  });
  mocks.sessions.mockImplementation(function () {
    return { resolve: mocks.resolve };
  });
  mocks.hasher.mockImplementation(function () {
    return {};
  });
  mocks.tokens.mockImplementation(function () {
    return {};
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('request session composition', () => {
  it('lazily shares one five-connection pool and complete account ports', async () => {
    const { resolveRequestUser, requireUser } = await import('./account-services');
    expect(mocks.postgres).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue(user);
    await expect(resolveRequestUser(request(`mindsprout_session=${token}`))).resolves.toBe(user);
    await expect(requireUser(request(`mindsprout_session=${token}`))).resolves.toBe(user);
    expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith(
      'postgres://app:local@localhost/accounts',
      { max: 5 },
    );
    expect(mocks.users).toHaveBeenCalledExactlyOnceWith(mocks.sql);
    expect(mocks.sessions).toHaveBeenCalledExactlyOnceWith(mocks.sql);
    expect(mocks.hasher).toHaveBeenCalledOnce();
    expect(mocks.tokens).toHaveBeenCalledOnce();
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
    expect(mocks.resolve).toHaveBeenCalledWith(token, now);
  });

  it('fails on first composed use without a database URL, before creating a pool', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    const { requireUser } = await import('./account-services');
    await expect(requireUser(request(`mindsprout_session=${token}`))).rejects.toThrow(
      'DATABASE_URL',
    );
    expect(mocks.postgres).not.toHaveBeenCalled();
    vi.stubEnv('DATABASE_URL', 'postgres://app:local@localhost/accounts');
    mocks.resolve.mockResolvedValue(user);
    await expect(requireUser(request(`mindsprout_session=${token}`))).resolves.toBe(user);
    expect(mocks.postgres).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    '',
    'other=value',
    'mindsprout_session=',
    'mindsprout_session; =wrong; xmindsprout_session=wrong; mindsprout_session_extra=wrong',
    'MindSprout_session=wrong; other=mindsprout_session=wrong',
  ])('refuses absent or malformed session cookie %j without database access', async (cookie) => {
    vi.stubEnv('DATABASE_URL', undefined);
    const { requireUser } = await import('./account-services');
    const response = await requireUser(request(cookie));
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error('Expected unauthenticated response');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it.each([
    [`other=wrong;\t mindsprout_session \t=${token}; other=last`, token],
    ['mindsprout_session=first; mindsprout_session=second', 'first'],
    ['mindsprout_session=; malformed; mindsprout_session=second', 'second'],
    ['mindsprout_session=%E0%A4%A; other=last', '%E0%A4%A'],
    ['mindsprout_session= leading trailing ; other=last', ' leading trailing '],
    ['mindsprout_session=opaque=value; other=last', 'opaque=value'],
  ])('preserves the first nonempty exact-name cookie in %s', async (cookie, expected) => {
    const { resolveRequestUser } = await import('./account-services');
    mocks.resolve.mockResolvedValue(user);
    await expect(resolveRequestUser(request(cookie))).resolves.toBe(user);
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(expected, now);
  });

  it.each(['forged', 'expired', 'unknown'])(
    'refuses a repository-denied %s session',
    async (value) => {
      const { requireUser } = await import('./account-services');
      mocks.resolve.mockResolvedValue(undefined);
      const response = await requireUser(request(`mindsprout_session=${value}`));
      expect(response).toBeInstanceOf(Response);
      if (!(response instanceof Response)) throw new Error('Expected unauthenticated response');
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
      expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(value, now);
    },
  );

  it('propagates unexpected repository failures instead of denying authentication', async () => {
    const { requireUser } = await import('./account-services');
    const failure = new Error('database unavailable');
    mocks.resolve.mockRejectedValue(failure);
    await expect(requireUser(request(`mindsprout_session=${token}`))).rejects.toBe(failure);
  });
});

describe('session response cookies', () => {
  it.each(['development', 'production'] as const)(
    'sets and clears the scoped cookie in %s',
    async (environment) => {
      vi.stubEnv('NODE_ENV', environment);
      vi.stubEnv('DATABASE_URL', undefined);
      const { setSessionCookie, clearSessionCookie } = await import('./account-services');
      const response = NextResponse.json({});
      const set = vi.spyOn(response.cookies, 'set');
      setSessionCookie(response, token);
      const secure = environment === 'production';
      expect(set).toHaveBeenLastCalledWith('mindsprout_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 2592000,
        secure,
      });
      expect(response.headers.get('set-cookie')).toBe(
        `mindsprout_session=${token}; Path=/; Expires=Mon, 14 Dec 2026 00:00:00 GMT; Max-Age=2592000;${secure ? ' Secure;' : ''} HttpOnly; SameSite=lax`,
      );
      clearSessionCookie(response);
      expect(set).toHaveBeenLastCalledWith('mindsprout_session', '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
        secure,
      });
      expect(response.headers.get('set-cookie')).toBe(
        `mindsprout_session=; Path=/; Max-Age=0;${secure ? ' Secure;' : ''} HttpOnly; SameSite=lax`,
      );
      expect(mocks.postgres).not.toHaveBeenCalled();
    },
  );
});
