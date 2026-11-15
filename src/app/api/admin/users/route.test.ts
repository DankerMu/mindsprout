import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountError, type User } from '@/contexts/account/domain/account';
import { logger } from '@/shared/logger';

const { requireUser, listAccounts } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listAccounts: vi.fn(),
}));
vi.mock('@/app/server/account-services', () => ({ requireUser, listAccounts }));

import { GET } from './route';

const admin: User = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  username: 'owner',
  isAdmin: true,
  createdAt: '2026-11-01T00:00:00.000Z',
};

beforeEach(() => {
  requireUser.mockResolvedValue(admin);
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('GET /api/admin/users', () => {
  it('returns only public accounts unchanged in oldest-first use-case order', async () => {
    const users = [
      admin,
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        username: 'zoe',
        isAdmin: false,
        createdAt: '2026-11-02T00:00:00.000Z',
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        username: 'alice',
        isAdmin: false,
        createdAt: '2026-11-02T00:00:00.000Z',
      },
    ];
    listAccounts.mockResolvedValue(users);
    const request = new Request('http://localhost/api/admin/users');
    const response = await GET(request);
    expect(requireUser).toHaveBeenCalledExactlyOnceWith(request);
    expect(listAccounts).toHaveBeenCalledExactlyOnceWith(admin);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(users);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([undefined, 'forged', 'expired'])(
    'refuses %s sessions before account access',
    async (token) => {
      const denied = Response.json({ error: 'unauthenticated' }, { status: 401 });
      requireUser.mockResolvedValue(denied);
      const request = new Request('http://localhost/api/admin/users', {
        headers: token === undefined ? {} : { cookie: `mindsprout_session=${token}` },
      });
      const json = vi.spyOn(request, 'json');
      const response = await GET(request);
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(request);
      expect(response).toBe(denied);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
      expect(listAccounts).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it('refuses regular users before listing accounts', async () => {
    requireUser.mockResolvedValue({ ...admin, isAdmin: false });
    const response = await GET(new Request('http://localhost/api/admin/users'));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
    expect(listAccounts).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('preserves use-case authorization denial', async () => {
    listAccounts.mockRejectedValue(new AccountError('forbidden'));
    const response = await GET(new Request('http://localhost/api/admin/users'));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    'session',
    'session-account-error',
    'composition',
    'composition-account-error',
    'repository',
    'unexpected-account-error',
  ])('returns a safe 500 for %s failure', async (source) => {
    const failure = new Error('private-actor cookie-secret database-secret');
    if (source === 'session') requireUser.mockRejectedValue(failure);
    if (source === 'session-account-error')
      requireUser.mockRejectedValue(new AccountError('forbidden'));
    if (source === 'composition-account-error')
      listAccounts.mockImplementation(() => {
        throw new AccountError('forbidden');
      });
    if (source === 'composition')
      listAccounts.mockImplementation(() => {
        throw failure;
      });
    if (source === 'repository') listAccounts.mockRejectedValue(failure);
    if (source === 'unexpected-account-error')
      listAccounts.mockRejectedValue(new AccountError('invalid-input'));
    const response = await GET(
      new Request('http://localhost/api/admin/users?secret=private-actor'),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal' });
    expect(logger.error).toHaveBeenCalledExactlyOnceWith({ event: 'account.list.failed' });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
    if (source === 'session') expect(listAccounts).not.toHaveBeenCalled();
  });
});
