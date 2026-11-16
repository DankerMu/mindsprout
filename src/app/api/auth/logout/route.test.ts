import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AccountServices from '@/app/server/account-services';

const { signOutRequest, errorLog } = vi.hoisted(() => ({
  signOutRequest: vi.fn(),
  errorLog: vi.fn(),
}));
vi.mock('@/app/server/account-services', async (importOriginal) => ({
  ...(await importOriginal<typeof AccountServices>()),
  signOutRequest,
}));
vi.mock('@/shared/logger', () => ({ logger: { error: errorLog } }));

import { POST } from './route';

function request(cookie?: string, body = '{}'): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookie !== undefined) headers.set('cookie', cookie);
  return new Request('http://localhost/api/auth/logout?secret=query-secret', {
    method: 'POST',
    headers,
    body,
  });
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe('POST /api/auth/logout', () => {
  it.each([
    ['development', undefined],
    ['development', 'mindsprout_session='],
    ['development', 'mindsprout_session=valid-token'],
    ['development', 'mindsprout_session=unknown-token'],
    ['production', 'mindsprout_session=valid-token'],
  ] as const)(
    'ends the session and clears its cookie in %s for %s',
    async (environment, cookie) => {
      vi.stubEnv('NODE_ENV', environment);
      const input = request(cookie);
      const response = await POST(input);
      expect(signOutRequest).toHaveBeenCalledExactlyOnceWith(input);
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
      await expect(response.text()).resolves.toBe('');
      expect(response.headers.getSetCookie()).toEqual([
        `mindsprout_session=; Path=/; Max-Age=0;${environment === 'production' ? ' Secure;' : ''} HttpOnly; SameSite=lax`,
        `mindsprout_session_binding=; Path=/; Max-Age=0;${environment === 'production' ? ' Secure;' : ''} SameSite=lax`,
      ]);
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it.each(['{}', 'null', '[1]', '{', ''])('consumes no payload fields from %j', async (body) => {
    const input = request(undefined, body);
    input.headers.set('content-type', 'Application/JSON; charset=utf-8');
    const json = vi.spyOn(input, 'json');
    const response = await POST(input);
    expect(response.status).toBe(204);
    expect(input.bodyUsed).toBe(false);
    expect(json).not.toHaveBeenCalled();
    expect(signOutRequest).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each([
    undefined,
    'application/x-www-form-urlencoded',
    'text/plain',
    'application/problem+json',
    'application/json; charset',
  ])('refuses media type %s before sign-out or cookie clearing', async (contentType) => {
    const input = request('mindsprout_session=private-token', 'logout=true');
    if (contentType === undefined) input.headers.delete('content-type');
    else input.headers.set('content-type', contentType);
    const json = vi.spyOn(input, 'json');
    const response = await POST(input);
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ error: 'unsupported-media-type' });
    expect(input.bodyUsed).toBe(false);
    expect(json).not.toHaveBeenCalled();
    expect(signOutRequest).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('keeps deletion failures internal without clearing the cookie or logging secrets', async () => {
    signOutRequest.mockRejectedValue(new Error('private-token body-secret query-secret'));
    const input = request('mindsprout_session=private-token', '{"secret":"body-secret"}');
    const response = await POST(input);
    expect(signOutRequest).toHaveBeenCalledExactlyOnceWith(input);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(errorLog).toHaveBeenCalledExactlyOnceWith({ event: 'account.logout.failed' });
  });
});
