import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AccountServices from '@/app/server/account-services';
import { type MindMap, UnsupportedSchemaVersionError } from '@/contexts/account/acl/map';

const { requireUser, mapsForUser, get, put, remove, errorLog } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  mapsForUser: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  errorLog: vi.fn(),
}));
vi.mock('@/app/server/account-services', async (importOriginal) => ({
  ...(await importOriginal<typeof AccountServices>()),
  requireUser,
  mapsForUser,
}));
vi.mock('@/shared/logger', () => ({ logger: { error: errorLog } }));

import { DELETE, GET, PUT } from './route';

beforeEach(() => {
  requireUser.mockResolvedValue({ id: 'owner-id' });
  mapsForUser.mockReturnValue({ get, put, delete: remove });
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

function writeRequest(method: string, body = JSON.stringify({ schemaVersion: 1, map })): Request {
  return new Request('http://localhost/api/maps/map-id', {
    method,
    headers: { 'content-type': 'application/json', cookie: 'mindsprout_session=valid' },
    body,
  });
}

describe.each([
  ['PUT', () => PUT],
  ['DELETE', () => DELETE],
] as const)('%s /api/maps/{id}', (method, handler) => {
  it.each([undefined, 'forged', 'expired'])(
    'refuses session %s before media guard, params, body or store',
    async (token) => {
      const denied = Response.json({ error: 'unauthenticated' }, { status: 401 });
      requireUser.mockResolvedValue(denied);
      const input = writeRequest(method);
      input.headers.delete('content-type');
      input.headers.delete('cookie');
      if (token) input.headers.set('cookie', `mindsprout_session=${token}`);
      const headersRead = vi.spyOn(input.headers, 'get');
      const bodyRead = vi.spyOn(input, 'body', 'get');
      const response = await handler()(input, {
        params: ObservedParams.resolve({ id: 'map-id' }),
      });
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(input);
      expect(response).toBe(denied);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
      expect(headersRead).not.toHaveBeenCalled();
      expect(bodyRead).not.toHaveBeenCalled();
      expect(paramsAwaited).not.toHaveBeenCalled();
      expect(mapsForUser).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    'application/x-www-form-urlencoded',
    'text/plain',
    'application/problem+json',
  ])('refuses media type %s before params, body or store', async (contentType) => {
    const input = writeRequest(method);
    if (contentType) input.headers.set('content-type', contentType);
    else input.headers.delete('content-type');
    input.headers.set('content-length', '1048577');
    const bodyRead = vi.spyOn(input, 'body', 'get');
    const response = await handler()(input, {
      params: ObservedParams.resolve({ id: 'map-id' }),
    });
    expect(requireUser).toHaveBeenCalledExactlyOnceWith(input);
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ error: 'unsupported-media-type' });
    expect(bodyRead).not.toHaveBeenCalled();
    expect(paramsAwaited).not.toHaveBeenCalled();
    expect(mapsForUser).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each(['session', 'params', 'composition', 'store'])(
    'keeps %s failures inside the safe error boundary',
    async (source) => {
      const failure = new Error('Private note cookie-secret database-secret');
      if (source === 'session') requireUser.mockRejectedValue(failure);
      if (source === 'params')
        paramsAwaited.mockImplementation(() => {
          throw failure;
        });
      if (source === 'composition')
        mapsForUser.mockImplementation(() => {
          throw failure;
        });
      if (source === 'store') {
        put.mockRejectedValue(failure);
        remove.mockRejectedValue(failure);
      }
      const response = await handler()(writeRequest(method), {
        params: ObservedParams.resolve({ id: 'map-id' }),
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'internal' });
      expect(errorLog).toHaveBeenCalledExactlyOnceWith({
        event: `map.${method.toLowerCase()}.failed`,
      });
      expect(response.headers.get('set-cookie')).toBeNull();
    },
  );
});

describe('PUT map validation and size', () => {
  it('saves the real parsed forest once for the authenticated owner and path', async () => {
    const input = writeRequest('PUT');
    input.headers.set('content-type', 'Application/JSON; charset=utf-8');
    const response = await PUT(input, { params: Promise.resolve({ id: 'map-id' }) });
    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe('');
    expect(requireUser).toHaveBeenCalledExactlyOnceWith(input);
    expect(mapsForUser).toHaveBeenCalledExactlyOnceWith('owner-id');
    expect(put).toHaveBeenCalledExactlyOnceWith(map);
    expect(input.bodyUsed).toBe(true);
    await expect(input.text()).rejects.toThrow();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each([
    [
      'floating root without position',
      {
        schemaVersion: 1,
        map: {
          ...map,
          roots: [
            { id: 'primary', text: 'Primary', children: [] },
            { id: 'floating', text: 'Floating', children: [] },
          ],
        },
      },
    ],
    [
      'duplicate node ids',
      {
        schemaVersion: 1,
        map: {
          ...map,
          roots: [
            {
              id: 'duplicate',
              text: 'Root',
              children: [{ id: 'duplicate', text: 'Child', children: [] }],
            },
          ],
        },
      },
    ],
    ['newer schema', { schemaVersion: 2, map }],
    ['string schema', { schemaVersion: '1', map }],
    ['missing schema', { map }],
    ['different embedded id', { schemaVersion: 1, map: { ...map, id: 'other-map' } }],
    ['missing map', { schemaVersion: 1 }],
    ['null envelope', null],
    ['array envelope', []],
    ['scalar envelope', 1],
  ])('refuses %s without constructing the store', async (_name, envelope) => {
    const response = await PUT(writeRequest('PUT', JSON.stringify(envelope)), {
      params: Promise.resolve({ id: 'map-id' }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid-map' });
    expect(mapsForUser).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each(['{', ''])('refuses malformed JSON %j without writing', async (body) => {
    const response = await PUT(writeRequest('PUT', body), {
      params: Promise.resolve({ id: 'map-id' }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid-map' });
    expect(put).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('rejects declared overflow before accessing the body or store', async () => {
    const input = writeRequest('PUT');
    input.headers.set('content-length', '1048577');
    const bodyRead = vi.spyOn(input, 'body', 'get');
    const response = await PUT(input, { params: Promise.resolve({ id: 'map-id' }) });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'too-large' });
    expect(bodyRead).not.toHaveBeenCalled();
    expect(mapsForUser).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it.each([undefined, '1', 'not-a-number'])(
    'stops streaming immediately at actual byte overflow with length %s',
    async (length) => {
      let pulls = 0;
      const cancelled = vi.fn();
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new TextEncoder().encode(pulls === 1 ? 'é'.repeat(524288) : 'x'));
          },
          cancel: cancelled,
        },
        { highWaterMark: 0 },
      );
      const input = new Request('http://localhost/api/maps/map-id', {
        method: 'PUT',
        body: stream,
        duplex: 'half',
        headers: { 'content-type': 'application/json' },
      } as RequestInit);
      if (length) input.headers.set('content-length', length);
      const response = await PUT(input, { params: Promise.resolve({ id: 'map-id' }) });
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({ error: 'too-large' });
      expect(pulls).toBe(2);
      expect(cancelled).toHaveBeenCalledOnce();
      expect(mapsForUser).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])('validates exactly 1048576 bytes normally (valid=%s)', async (valid) => {
    const json = valid ? JSON.stringify({ schemaVersion: 1, map }) : '{';
    const input = writeRequest(
      'PUT',
      json + ' '.repeat(1048576 - new TextEncoder().encode(json).length),
    );
    input.headers.set('content-length', '1048576');
    const response = await PUT(input, { params: Promise.resolve({ id: 'map-id' }) });
    expect(response.status).toBe(valid ? 204 : 400);
    if (valid) expect(put).toHaveBeenCalledExactlyOnceWith(map);
    else {
      await expect(response.json()).resolves.toEqual({ error: 'invalid-map' });
      expect(put).not.toHaveBeenCalled();
    }
  });

  it('refuses an absent body as invalid JSON', async () => {
    const input = new Request('http://localhost/api/maps/map-id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
    });
    const response = await PUT(input, { params: Promise.resolve({ id: 'map-id' }) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid-map' });
    expect(mapsForUser).not.toHaveBeenCalled();
  });

  it('preserves UTF-8 split across stream chunks without rereading the body', async () => {
    const unicodeMap = { ...map, title: 'é漢' };
    const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, map: unicodeMap }));
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (offset === bytes.length) controller.close();
          else controller.enqueue(bytes.subarray(offset, ++offset));
        },
      },
      { highWaterMark: 0 },
    );
    const input = new Request('http://localhost/api/maps/map-id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await PUT(input, { params: Promise.resolve({ id: 'map-id' }) });
    expect(response.status).toBe(204);
    expect(put).toHaveBeenCalledExactlyOnceWith(unicodeMap);
    expect(input.bodyUsed).toBe(true);
  });

  it('keeps a stream failure out of invalid-map responses and releases the reader', async () => {
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.error(new Error('private stream details'));
        },
      },
      { highWaterMark: 0 },
    );
    const input = new Request('http://localhost/api/maps/map-id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await PUT(input, { params: Promise.resolve({ id: 'map-id' }) });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal' });
    expect(errorLog).toHaveBeenCalledExactlyOnceWith({ event: 'map.put.failed' });
    expect(mapsForUser).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
  });
});

describe('DELETE map', () => {
  it.each(['map-id', 'absent', 'foreign', ''])(
    'deletes %j once with no payload policy',
    async (id) => {
      const input = writeRequest('DELETE', 'not JSON');
      input.headers.set('content-length', '1048577');
      const bodyRead = vi.spyOn(input, 'body', 'get');
      const response = await DELETE(input, { params: Promise.resolve({ id }) });
      expect(response.status).toBe(204);
      await expect(response.text()).resolves.toBe('');
      expect(mapsForUser).toHaveBeenCalledExactlyOnceWith('owner-id');
      expect(remove).toHaveBeenCalledExactlyOnceWith(id);
      expect(bodyRead).not.toHaveBeenCalled();
      expect(input.bodyUsed).toBe(false);
      expect(errorLog).not.toHaveBeenCalled();
    },
  );
});
