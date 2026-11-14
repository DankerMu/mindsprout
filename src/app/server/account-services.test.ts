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
  register: vi.fn(),
  findByUsername: vi.fn(),
  hash: vi.fn(),
  verify: vi.fn(),
  sessionToken: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
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
    return { register: mocks.register, findByUsername: mocks.findByUsername };
  });
  mocks.sessions.mockImplementation(function () {
    return {
      resolve: mocks.resolve,
      createIfPasswordHashMatches: mocks.create,
      delete: mocks.delete,
    };
  });
  mocks.hasher.mockImplementation(function () {
    return { hash: mocks.hash, verify: mocks.verify };
  });
  mocks.tokens.mockImplementation(function () {
    return { sessionToken: mocks.sessionToken };
  });
  mocks.register.mockResolvedValue(user);
  mocks.findByUsername.mockResolvedValue({ user, passwordHash: 'stored-hash' });
  mocks.hash.mockResolvedValue('stored-hash');
  mocks.verify.mockResolvedValue(true);
  mocks.sessionToken.mockReturnValue(token);
  mocks.create.mockResolvedValue(true);
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

describe('credential composition', () => {
  const credentials = { username: ' Alice ', password: ' exact password ' };

  it('reads JSON once, preserving strings and leaving length policy to the core', async () => {
    const { readCredentials } = await import('./account-services');
    const input = { username: '', password: 'p'.repeat(257), extra: true };
    const request = new Request('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const json = vi.spyOn(request, 'json');
    await expect(readCredentials(request)).resolves.toEqual({
      username: '',
      password: 'p'.repeat(257),
    });
    expect(json).toHaveBeenCalledOnce();
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it.each(['{', 'null', '[]', 'true', '{}', '{"username":"a","password":null}'])(
    'rejects invalid JSON credentials %s without opening the database',
    async (body) => {
      const { readCredentials } = await import('./account-services');
      const request = new Request('http://localhost/api/auth/register', { method: 'POST', body });
      await expect(readCredentials(request)).rejects.toMatchObject({
        name: 'AccountError',
        code: 'invalid-input',
      });
      expect(mocks.postgres).not.toHaveBeenCalled();
      expect(mocks.hash).not.toHaveBeenCalled();
      expect(mocks.register).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it('registers and signs in through the real use cases sharing the session ports', async () => {
    const { registerAccount, signInAccount, resolveRequestUser } =
      await import('./account-services');
    expect(mocks.postgres).not.toHaveBeenCalled();
    await expect(registerAccount(credentials)).resolves.toEqual({ user, token });
    expect(mocks.hash).toHaveBeenCalledExactlyOnceWith(' exact password ');
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith(' Alice ', 'stored-hash');
    await expect(signInAccount(credentials)).resolves.toEqual({ user, token });
    expect(mocks.findByUsername).toHaveBeenCalledExactlyOnceWith(' Alice ');
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(' exact password ', 'stored-hash');
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenNthCalledWith(
      1,
      token,
      { userId: 'user-1', expiresAt: '2026-12-14T00:00:00.000Z' },
      'stored-hash',
    );
    expect(mocks.create).toHaveBeenNthCalledWith(
      2,
      token,
      { userId: 'user-1', expiresAt: '2026-12-14T00:00:00.000Z' },
      'stored-hash',
    );
    mocks.resolve.mockResolvedValue(user);
    await expect(resolveRequestUser(request(`mindsprout_session=${token}`))).resolves.toBe(user);
    expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith(
      'postgres://app:local@localhost/accounts',
      { max: 5 },
    );
    expect(mocks.users).toHaveBeenCalledOnce();
    expect(mocks.sessions).toHaveBeenCalledOnce();
    expect(mocks.hasher).toHaveBeenCalledOnce();
    expect(mocks.tokens).toHaveBeenCalledOnce();
  });

  it.each(['registerAccount', 'signInAccount'] as const)(
    '%s retains core invalid-input checks before account or session operations',
    async (operation) => {
      const services = await import('./account-services');
      await expect(services[operation]({ username: '', password: 'pw' })).rejects.toMatchObject({
        name: 'AccountError',
        code: 'invalid-input',
      });
      expect(mocks.hash).not.toHaveBeenCalled();
      expect(mocks.register).not.toHaveBeenCalled();
      expect(mocks.findByUsername).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it('preserves interrupted registration as an internal failure without retrying', async () => {
    const { registerAccount } = await import('./account-services');
    mocks.create.mockResolvedValue(false);
    await expect(registerAccount(credentials)).rejects.toMatchObject({
      name: 'Error',
      message: 'Registration session issuance refused',
    });
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      token,
      { userId: 'user-1', expiresAt: '2026-12-14T00:00:00.000Z' },
      'stored-hash',
    );
  });

  it('preserves stale sign-in refusal after a credential reset', async () => {
    const { signInAccount } = await import('./account-services');
    mocks.create.mockResolvedValue(false);
    await expect(signInAccount(credentials)).rejects.toMatchObject({
      name: 'AccountError',
      code: 'invalid-credentials',
    });
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(' exact password ', 'stored-hash');
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      token,
      { userId: 'user-1', expiresAt: '2026-12-14T00:00:00.000Z' },
      'stored-hash',
    );
    expect(mocks.register).not.toHaveBeenCalled();
  });
});

describe('JSON media guard', () => {
  it.each([
    'application/json',
    'APPLICATION/JSON',
    ' \tApplication/Json\t ',
    'application/json; charset=utf-8',
    'application/json \t; charset="utf-8"; profile="a;b"',
    'application/json; profile="escaped\\"quote"',
  ])('accepts the JSON media type %j without consuming the body', async (contentType) => {
    const { requireJson } = await import('./account-services');
    const input = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: '{}',
    });
    expect(requireJson(input)).toBeUndefined();
    expect(input.bodyUsed).toBe(false);
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    '',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=example',
    'text/plain',
    'application/problem+json',
    'application/*+json',
    'application/jsonp',
    'application /json',
    'application/json, text/plain',
    'application/json; charset',
    'application/json; charset=',
    'application/json; charset="unterminated',
    'application/json; charset=utf-8 garbage',
    'application/json;',
    'application/json; =utf-8',
    'application/json\u00a0',
  ])('refuses unsupported or malformed media type %j without side effects', async (contentType) => {
    vi.stubEnv('DATABASE_URL', undefined);
    const { requireJson } = await import('./account-services');
    const input = new Request('http://localhost', { method: 'POST', body: '{}' });
    if (contentType === undefined) input.headers.delete('content-type');
    else input.headers.set('content-type', contentType);
    const response = requireJson(input);
    expect(response?.status).toBe(415);
    await expect(response?.json()).resolves.toEqual({ error: 'unsupported-media-type' });
    expect(response?.headers.get('set-cookie')).toBeNull();
    expect(input.bodyUsed).toBe(false);
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});

describe('request sign-out composition', () => {
  it.each([undefined, '', 'other=value', 'mindsprout_session=', 'MindSprout_session=wrong'])(
    'succeeds without database configuration for absent or empty token %j',
    async (cookie) => {
      vi.stubEnv('DATABASE_URL', undefined);
      const { signOutRequest } = await import('./account-services');
      await expect(signOutRequest(request(cookie))).resolves.toBeUndefined();
      expect(mocks.postgres).not.toHaveBeenCalled();
      expect(mocks.delete).not.toHaveBeenCalled();
      expect(mocks.resolve).not.toHaveBeenCalled();
    },
  );

  it.each([
    [`mindsprout_session=${token}`, token],
    ['mindsprout_session=unknown', 'unknown'],
    ['xmindsprout_session=wrong; mindsprout_session=forged', 'forged'],
    ['mindsprout_session=first; mindsprout_session=second', 'first'],
    ['mindsprout_session=; malformed; mindsprout_session=%E0%A4%A', '%E0%A4%A'],
    ['mindsprout_session= leading trailing ; other=last', ' leading trailing '],
    ['mindsprout_session=opaque=value; other=last', 'opaque=value'],
  ])(
    'deletes only the exact opaque token in %s without authorization',
    async (cookie, expected) => {
      const { signOutRequest } = await import('./account-services');
      await expect(signOutRequest(request(cookie))).resolves.toBeUndefined();
      expect(mocks.delete).toHaveBeenCalledExactlyOnceWith(expected);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith(
        'postgres://app:local@localhost/accounts',
        { max: 5 },
      );
    },
  );

  it('propagates session deletion failures unchanged', async () => {
    const { signOutRequest } = await import('./account-services');
    const failure = new Error('database unavailable');
    mocks.delete.mockRejectedValue(failure);
    await expect(signOutRequest(request(`mindsprout_session=${token}`))).rejects.toBe(failure);
    expect(mocks.delete).toHaveBeenCalledExactlyOnceWith(token);
  });

  it('propagates missing configuration for a present token without opening a pool', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    const { signOutRequest } = await import('./account-services');
    await expect(signOutRequest(request(`mindsprout_session=${token}`))).rejects.toThrow(
      'DATABASE_URL',
    );
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
