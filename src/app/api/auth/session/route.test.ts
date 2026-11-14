import { afterEach, describe, expect, it, vi } from 'vitest';

const { requireUser, errorLog } = vi.hoisted(() => ({ requireUser: vi.fn(), errorLog: vi.fn() }));
vi.mock('@/app/server/account-services', () => ({ requireUser }));
vi.mock('@/shared/logger', () => ({ logger: { error: errorLog } }));

import { GET, dynamic } from './route';

afterEach(() => vi.resetAllMocks());

describe('GET /api/auth/session', () => {
  it.each([false, true])(
    'returns only the current username and admin flag (%s)',
    async (isAdmin) => {
      const request = new Request('http://localhost/api/auth/session', {
        headers: { cookie: 'mindsprout_session=valid-token' },
      });
      requireUser.mockResolvedValue({
        id: 'private-id',
        username: 'Alice',
        isAdmin,
        createdAt: '2026-11-01T00:00:00.000Z',
      });
      const response = await GET(request);
      expect(dynamic).toBe('force-dynamic');
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(request);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ username: 'Alice', isAdmin });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'forged', 'expired', 'unknown'])(
    'returns the session denial for %s',
    async (token) => {
      const denied = Response.json({ error: 'unauthenticated' }, { status: 401 });
      requireUser.mockResolvedValue(denied);
      const request = new Request('http://localhost/api/auth/session', {
        headers: token === undefined ? {} : { cookie: `mindsprout_session=${token}` },
      });
      const response = await GET(request);
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(request);
      expect(response).toBe(denied);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it('returns a generic internal error and logs no request or failure secrets', async () => {
    const request = new Request('http://localhost/api/auth/session?password=query-secret', {
      headers: { cookie: 'mindsprout_session=secret-token', authorization: 'secret-credential' },
    });
    const failure = Object.assign(new Error('secret-token password body-secret'), { request });
    requireUser.mockRejectedValue(failure);
    const response = await GET(request);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal' });
    expect(errorLog).toHaveBeenCalledExactlyOnceWith({ event: 'account.session.failed' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
