import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MindMap, UnsupportedSchemaVersionError } from '@/contexts/account/acl/map';

const { requireUser, mapsForUser, get, errorLog } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  mapsForUser: vi.fn(),
  get: vi.fn(),
  errorLog: vi.fn(),
}));
vi.mock('@/app/server/account-services', () => ({ requireUser, mapsForUser }));
vi.mock('@/shared/logger', () => ({ logger: { error: errorLog } }));

import { GET } from './route';

beforeEach(() => {
  requireUser.mockResolvedValue({ id: 'owner-id' });
  mapsForUser.mockReturnValue({ get });
});
afterEach(() => vi.resetAllMocks());

const map: MindMap = {
  id: 'map-id',
  title: 'A forest',
  createdAt: 'created',
  updatedAt: 'updated',
  roots: [
    {
      id: 'primary',
      text: 'Root',
      children: [
        {
          id: 'child',
          text: 'Child',
          note: 'Private note',
          color: 'purple',
          collapsed: false,
          children: [],
        },
      ],
    },
    { id: 'floating', text: 'Floating', position: { x: -10, y: 20 }, children: [] },
  ],
};

function request(token?: string): Request {
  return new Request('http://localhost/api/maps/map-id', {
    headers: token === undefined ? {} : { cookie: `mindsprout_session=${token}` },
  });
}

// A Promise subclass makes awaiting observable even when the session is refused.
class ObservedParams extends Promise<{ id: string }> {
  override then<TResult1 = { id: string }, TResult2 = never>(
    onfulfilled?: ((value: { id: string }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    paramsAwaited();
    return super.then(onfulfilled, onrejected);
  }
}
const paramsAwaited = vi.fn();
afterEach(() => paramsAwaited.mockReset());

describe('GET /api/maps/{id}', () => {
  it('authenticates before awaiting params and returns the stored map verbatim in a version-one envelope', async () => {
    get.mockResolvedValue(map);
    const params = ObservedParams.resolve({ id: 'map-id' });
    paramsAwaited.mockImplementation(() => {
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(input);
      expect(mapsForUser).not.toHaveBeenCalled();
    });
    const input = request('valid');
    const response = await GET(input, { params });
    expect(paramsAwaited).toHaveBeenCalledOnce();
    expect(mapsForUser).toHaveBeenCalledExactlyOnceWith('owner-id');
    expect(get).toHaveBeenCalledExactlyOnceWith('map-id');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ schemaVersion: 1, map });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each(['absent', 'foreign', 'not-a-uuid', ''])(
    'returns indistinguishable absence for %j without id validation',
    async (id) => {
      get.mockResolvedValue(undefined);
      const response = await GET(request(), { params: Promise.resolve({ id }) });
      expect(mapsForUser).toHaveBeenCalledExactlyOnceWith('owner-id');
      expect(get).toHaveBeenCalledExactlyOnceWith(id);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'not-found' });
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it.each([2, 7])('reports stored schema version %s without map content', async (found) => {
    get.mockRejectedValue(new UnsupportedSchemaVersionError(found, 1));
    const response = await GET(request(), { params: Promise.resolve({ id: 'future' }) });
    expect(get).toHaveBeenCalledExactlyOnceWith('future');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'unsupported-schema-version', found });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each([undefined, 'forged', 'expired'])(
    'passes through session denial for %s without awaiting params or accessing maps',
    async (token) => {
      const denied = Response.json({ error: 'unauthenticated' }, { status: 401 });
      requireUser.mockResolvedValue(denied);
      const input = request(token);
      const params = ObservedParams.resolve({ id: 'private-map' });
      const response = await GET(input, { params });
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(input);
      expect(response).toBe(denied);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
      expect(paramsAwaited).not.toHaveBeenCalled();
      expect(mapsForUser).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it.each(['session', 'params', 'composition', 'get'])(
    'returns a safe internal failure for %s errors',
    async (source) => {
      const failure = new Error('private-map cookie-secret database-secret');
      if (source === 'session') requireUser.mockRejectedValue(failure);
      if (source === 'composition')
        mapsForUser.mockImplementation(() => {
          throw failure;
        });
      if (source === 'get') get.mockRejectedValue(failure);
      const params = ObservedParams.resolve({ id: 'private-map' });
      if (source === 'params')
        paramsAwaited.mockImplementation(() => {
          throw failure;
        });
      const response = await GET(request('cookie-secret'), { params });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'internal' });
      expect(errorLog).toHaveBeenCalledExactlyOnceWith({ event: 'map.get.failed' });
      expect(response.headers.get('set-cookie')).toBeNull();
      if (source === 'session') {
        expect(paramsAwaited).not.toHaveBeenCalled();
        expect(mapsForUser).not.toHaveBeenCalled();
      }
    },
  );
});
