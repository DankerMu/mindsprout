import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AccountServices from '@/app/server/account-services';
import { AccountError } from '@/contexts/account/domain/account';

const { signInAccount, errorLog } = vi.hoisted(() => ({
  signInAccount: vi.fn(),
  errorLog: vi.fn(),
}));
vi.mock('@/app/server/account-services', async (importOriginal) => ({
  ...(await importOriginal<typeof AccountServices>()),
  signInAccount,
}));
vi.mock('@/shared/logger', () => ({ logger: { error: errorLog } }));

import { POST } from './route';

const credentials = { username: ' Alice ', password: ' body-secret ' };
const token = 'private-session-token';
function request(body = JSON.stringify(credentials)): Request {
  return new Request('http://localhost/api/auth/login?password=query-secret', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'mindsprout_session=cookie-secret' },
    body,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T00:00:00.000Z'));
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('POST /api/auth/login', () => {
  it.each([undefined, 'application/x-www-form-urlencoded', 'text/plain'])(
    'refuses media type %s before reading credentials or signing in',
    async (contentType) => {
      const input = request(
        contentType === 'application/x-www-form-urlencoded'
          ? 'username=Alice&password=body-secret'
          : JSON.stringify(credentials),
      );
      if (contentType === undefined) input.headers.delete('content-type');
      else input.headers.set('content-type', contentType);
      const json = vi.spyOn(input, 'json');
      const response = await POST(input);
      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toEqual({ error: 'unsupported-media-type' });
      expect(json).not.toHaveBeenCalled();
      expect(input.bodyUsed).toBe(false);
      expect(signInAccount).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it.each(['APPLICATION/JSON', 'application/json; charset=utf-8'])(
    'signs in JSON credentials with media type %s',
    async (contentType) => {
      signInAccount.mockResolvedValue({ user: { username: ' Alice ', isAdmin: false }, token });
      const input = request();
      input.headers.set('content-type', contentType);
      const response = await POST(input);
      expect(response.status).toBe(200);
      expect(signInAccount).toHaveBeenCalledExactlyOnceWith(credentials);
    },
  );

  it.each([
    ['development', false],
    ['development', true],
    ['production', false],
    ['production', true],
  ] as const)('creates a public session in %s with admin=%s', async (environment, isAdmin) => {
    vi.stubEnv('NODE_ENV', environment);
    signInAccount.mockResolvedValue({
      user: { id: 'private-id', username: ' Alice ', isAdmin, createdAt: 'private-date' },
      token,
    });
    const response = await POST(request(JSON.stringify({ ...credentials, extra: 'accepted' })));
    expect(signInAccount).toHaveBeenCalledExactlyOnceWith(credentials);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ username: ' Alice ', isAdmin });
    expect(response.headers.get('set-cookie')).toBe(
      `mindsprout_session=${token}; Path=/; Expires=Mon, 14 Dec 2026 00:00:00 GMT; Max-Age=2592000;${environment === 'production' ? ' Secure;' : ''} HttpOnly; SameSite=lax`,
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '{',
    'null',
    '[]',
    '["Alice","pw"]',
    '"Alice"',
    '42',
    'true',
    '{}',
    '{"password":"pw"}',
    '{"username":"Alice"}',
    '{"username":null,"password":"pw"}',
    '{"username":"Alice","password":null}',
    '{"username":42,"password":"pw"}',
    '{"username":"Alice","password":42}',
    '{"username":false,"password":"pw"}',
    '{"username":"Alice","password":false}',
    '{"username":[],"password":"pw"}',
    '{"username":"Alice","password":[]}',
    '{"username":{},"password":"pw"}',
    '{"username":"Alice","password":{}}',
  ])('refuses invalid runtime credentials %s before sign-in', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid-input' });
    expect(signInAccount).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid-input', 400],
    ['invalid-credentials', 401],
  ] as const)(
    'maps %s including stale sign-in without a cookie or secret log',
    async (code, status) => {
      signInAccount.mockRejectedValue(new AccountError(code));
      const response = await POST(request());
      expect(signInAccount).toHaveBeenCalledExactlyOnceWith(credentials);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: code });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it.each([
    Object.assign(new Error('body-secret cookie-secret private-session-token'), { credentials }),
    new AccountError('username-taken'),
    new AccountError('forbidden'),
    new AccountError('not-found'),
  ])('keeps unexpected failures internal: %s', async (error) => {
    signInAccount.mockRejectedValue(error);
    const response = await POST(request());
    expect(signInAccount).toHaveBeenCalledExactlyOnceWith(credentials);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(errorLog).toHaveBeenCalledExactlyOnceWith({ event: 'account.login.failed' });
  });
});
