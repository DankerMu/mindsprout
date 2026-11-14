import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedSchemaVersionError } from '@/contexts/account/acl/map';

const { requireUser, mapsForUser, list, errorLog } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  mapsForUser: vi.fn(),
  list: vi.fn(),
  errorLog: vi.fn(),
}));
vi.mock('@/app/server/account-services', () => ({ requireUser, mapsForUser }));
vi.mock('@/shared/logger', () => ({ logger: { error: errorLog } }));

import { GET } from './route';

beforeEach(() => {
  requireUser.mockResolvedValue({ id: 'owner-id' });
  mapsForUser.mockReturnValue({ list });
});
afterEach(() => vi.resetAllMocks());

describe('GET /api/maps', () => {
  it('returns summaries in store order, including readable newer-version summaries', async () => {
    const summaries = [
      { id: 'newer-version', title: 'Future map', updatedAt: '2026-11-14' },
      { id: '𐀀', title: 'Tie first', updatedAt: '2026-11-13' },
      { id: '', title: 'Tie second', updatedAt: '2026-11-13' },
      { id: 'old', title: 'Older map', updatedAt: '2026-11-12' },
    ];
    list.mockResolvedValue(summaries);
    const request = new Request('http://localhost/api/maps');
    const response = await GET(request);
    expect(requireUser).toHaveBeenCalledExactlyOnceWith(request);
    expect(mapsForUser).toHaveBeenCalledExactlyOnceWith('owner-id');
    expect(list).toHaveBeenCalledExactlyOnceWith();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(summaries);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('returns an empty array for a user with no maps', async () => {
    list.mockResolvedValue([]);
    const response = await GET(new Request('http://localhost/api/maps'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it.each([undefined, 'forged', 'expired'])(
    'passes through session denial for %s before store access',
    async (token) => {
      const denied = Response.json({ error: 'unauthenticated' }, { status: 401 });
      requireUser.mockResolvedValue(denied);
      const request = new Request('http://localhost/api/maps', {
        headers: token === undefined ? {} : { cookie: `mindsprout_session=${token}` },
      });
      const response = await GET(request);
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(request);
      expect(response).toBe(denied);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
      expect(mapsForUser).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it.each(['session', 'composition', 'list', 'version'])(
    'returns a safe internal failure for %s errors',
    async (source) => {
      const failure = new Error('private-map cookie-secret database-secret');
      if (source === 'session') requireUser.mockRejectedValue(failure);
      if (source === 'composition')
        mapsForUser.mockImplementation(() => {
          throw failure;
        });
      if (source === 'list') list.mockRejectedValue(failure);
      if (source === 'version') list.mockRejectedValue(new UnsupportedSchemaVersionError(2, 1));
      const response = await GET(
        new Request('http://localhost/api/maps?secret=private-map', {
          headers: { cookie: 'mindsprout_session=cookie-secret' },
        }),
      );
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'internal' });
      expect(errorLog).toHaveBeenCalledExactlyOnceWith({ event: 'map.list.failed' });
      expect(response.headers.get('set-cookie')).toBeNull();
      if (source === 'session') expect(mapsForUser).not.toHaveBeenCalled();
    },
  );
});
