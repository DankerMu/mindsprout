import { describe, expect, it } from 'vitest';
import { mapOf, node } from '../../../../../tests/support/map-domain';
import { MapFetch } from '../../../../../tests/support/map-fetch';
import { StorageUnauthorizedError, UnsupportedSchemaVersionError } from '../../domain/errors';
import type { MapRepository } from '../../domain/map-repository';
import { HttpMapRepository } from './http-map-repository';

const operations = [
  { method: 'GET', call: (repository: MapRepository) => repository.list(), path: '/api/maps' },
  {
    method: 'GET',
    call: (repository: MapRepository) => repository.get('m1'),
    path: '/api/maps/m1',
  },
  {
    method: 'PUT',
    call: (repository: MapRepository) => repository.put(mapOf(node('r'))),
    path: '/api/maps/m1',
  },
  {
    method: 'DELETE',
    call: (repository: MapRepository) => repository.delete('m1'),
    path: '/api/maps/m1',
  },
];

async function expectPlainError(promise: Promise<unknown>, ...context: string[]): Promise<void> {
  const error: unknown = await promise.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error instanceof Error && error.constructor).toBe(Error);
  for (const text of context)
    expect(error).toHaveProperty('message', expect.stringContaining(text));
}

describe.each(operations)('$method $path failures', ({ method, call, path }) => {
  it('preserves the ended-session error even with an unreadable body', async () => {
    const server = new MapFetch();
    server.respondNext(() => new Response('not JSON', { status: 401 }));
    const result = call(new HttpMapRepository(server.fetch));
    await expect(result).rejects.toBeInstanceOf(StorageUnauthorizedError);
    await expect(result).rejects.toHaveProperty('name', 'StorageUnauthorizedError');
    expect(server.requests).toHaveLength(1);
  });

  it.each([400, 403, 404, 409, 413, 415, 500, 503])(
    'reports HTTP %i as a plain error',
    async (status) => {
      const server = new MapFetch();
      server.respondNext(() => new Response('not JSON', { status }));
      const result = call(new HttpMapRepository(server.fetch));
      if (method === 'GET' && path.endsWith('/m1') && status === 404) {
        await expect(result).resolves.toBeUndefined();
      } else {
        await expectPlainError(result, method, path, String(status));
      }
    },
  );

  it.each([
    new TypeError('network down'),
    new StorageUnauthorizedError('transport is not an HTTP 401'),
    new UnsupportedSchemaVersionError(2, 1),
  ])('wraps a fetch rejection as a plain error: $name', async (cause) => {
    const server = new MapFetch();
    server.respondNext(() => Promise.reject(cause));
    await expectPlainError(call(new HttpMapRepository(server.fetch)), method, path);
    expect(server.requests).toHaveLength(1);
  });

  it('wraps a synchronous fetch failure as a plain error', async () => {
    const fetchMap: typeof fetch = () => {
      throw new TypeError('offline');
    };
    await expectPlainError(call(new HttpMapRepository(fetchMap)), method, path);
  });
});

describe('HTTP read payloads', () => {
  it('preserves the exact unsupported version from get409', async () => {
    const server = new MapFetch();
    server.respondNext(() =>
      Response.json({ error: 'unsupported-schema-version', found: 2 }, { status: 409 }),
    );
    const result = new HttpMapRepository(server.fetch).get('m1');
    await expect(result).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);
    await expect(result).rejects.toMatchObject({ found: 2, supported: 1 });
  });

  it.each([
    null,
    [],
    {},
    { error: 'other', found: 2 },
    { error: 'unsupported-schema-version' },
    { error: 'unsupported-schema-version', found: '2' },
    { error: 'unsupported-schema-version', found: null },
  ])('refuses malformed get409 payload %# as a plain error', async (body) => {
    const server = new MapFetch();
    server.respondNext(() => Response.json(body, { status: 409 }));
    await expectPlainError(new HttpMapRepository(server.fetch).get('m1'), 'GET', 'm1', '409');
  });

  it.each([
    null,
    [],
    {},
    { map: mapOf(node('r')) },
    { schemaVersion: 2, map: mapOf(node('r')) },
    { schemaVersion: '1', map: mapOf(node('r')) },
    { schemaVersion: 1, map: null },
    { schemaVersion: 1, map: { ...mapOf(node('r')), roots: [] } },
    { schemaVersion: 1, map: mapOf(node('r', [node('r')])) },
  ])('names the requested id in malformed get200 payload %#', async (body) => {
    const server = new MapFetch();
    server.respondNext(() => Response.json(body));
    await expectPlainError(
      new HttpMapRepository(server.fetch).get('requested-id'),
      'GET',
      'requested-id',
      '200',
    );
  });

  it.each([null, {}, [null], [{}], [{ id: 'a', title: 'A', updatedAt: 1 }]])(
    'refuses malformed list success payload %#',
    async (body) => {
      const server = new MapFetch();
      server.respondNext(() => Response.json(body));
      await expectPlainError(new HttpMapRepository(server.fetch).list(), 'GET', '/api/maps', '200');
    },
  );

  it.each(operations.slice(0, 2))('reports malformed JSON from $path', async ({ call, path }) => {
    const server = new MapFetch();
    server.respondNext(() => new Response('{'));
    await expectPlainError(call(new HttpMapRepository(server.fetch)), 'GET', path, '200');
  });

  it.each(operations.slice(0, 2))(
    'reports a body stream failure from $path',
    async ({ call, path }) => {
      const server = new MapFetch();
      server.respondNext(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('body decode failed'));
              },
            }),
          ),
      );
      await expectPlainError(call(new HttpMapRepository(server.fetch)), 'GET', path, '200');
    },
  );

  it('does not interpret the unsupported body on another method or status', async () => {
    for (const { call, path } of operations) {
      const server = new MapFetch();
      server.respondNext(() =>
        Response.json({ error: 'unsupported-schema-version', found: 2 }, { status: 500 }),
      );
      await expectPlainError(call(new HttpMapRepository(server.fetch)), path, '500');
    }
    const server = new MapFetch();
    server.respondNext(() =>
      Response.json({ error: 'unsupported-schema-version', found: 2 }, { status: 409 }),
    );
    await expectPlainError(new HttpMapRepository(server.fetch).list(), '409');
  });
});
