import { describe, expect, it, vi } from 'vitest';
import { mapOf, node } from '../../../../../tests/support/map-domain';
import { MapFetch } from '../../../../../tests/support/map-fetch';
import { describeMapRepositoryContract } from '../../../../../tests/support/map-repository-contract';
import { HttpMapRepository } from './http-map-repository';

describeMapRepositoryContract('HTTP', () => new HttpMapRepository(new MapFetch().fetch));

describe('HTTP save transport', () => {
  it.each([
    [59999, 2, true],
    [60000, 3, true],
    [60001, 4, false],
  ])('uses UTF-8 bytes for a %i-byte body', async (bytes, padding, keepalive) => {
    // Empty-title envelope is 123 ASCII bytes; 19,958 CJK characters add 59,874 bytes.
    const map = {
      id: 'm',
      title: '界'.repeat(19958) + 'a'.repeat(padding),
      roots: [node('r')],
      createdAt: '',
      updatedAt: '',
    };
    const server = new MapFetch();
    await new HttpMapRepository(server.fetch).put(map);
    const init = server.requests[0]?.init;
    const body = init?.body;
    if (typeof body !== 'string') throw new Error('expected a serialized body');
    expect(Buffer.byteLength(body, 'utf8')).toBe(bytes);
    expect(init?.keepalive).toBe(keepalive);
    expect(JSON.parse(body)).toStrictEqual({ schemaVersion: 1, map });
  });

  it('starts the save synchronously and waits for its deferred response', async () => {
    const server = new MapFetch();
    let resolve: (response: Response) => void = () => {
      throw new Error('the held request has not started');
    };
    server.respondNext(
      () =>
        new Promise<Response>((release) => {
          resolve = release;
        }),
    );
    const settled = vi.fn();
    const saving = new HttpMapRepository(server.fetch).put(mapOf(node('r'))).then(settled);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.init?.method).toBe('PUT');
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    resolve(new Response(null, { status: 204 }));
    await saving;
    expect(settled).toHaveBeenCalledOnce();
  });

  it('uses relative encoded paths, JSON writes and no write response JSON', async () => {
    const server = new MapFetch();
    const repository = new HttpMapRepository(server.fetch);
    const map = { ...mapOf(node('r')), id: 'a/b ?#%雪' };
    await repository.put(map);
    expect(await repository.get(map.id)).toStrictEqual(map);
    expect(await repository.list()).toStrictEqual([
      { id: map.id, title: map.title, updatedAt: map.updatedAt },
    ]);
    await repository.delete(map.id);
    expect(await repository.get(map.id)).toBeUndefined();
    const path = '/api/maps/a%2Fb%20%3F%23%25%E9%9B%AA';
    expect(server.requests).toStrictEqual([
      {
        input: path,
        init: {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schemaVersion: 1, map }),
          keepalive: true,
        },
      },
      { input: path, init: { method: 'GET' } },
      { input: '/api/maps', init: { method: 'GET' } },
      {
        input: path,
        init: {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      },
      { input: path, init: { method: 'GET' } },
    ]);
  });

  it('serializes a save envelope only once', async () => {
    const server = new MapFetch();
    server.respondNext(() => new Response(null, { status: 204 }));
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      const map = mapOf(node('r'));
      await new HttpMapRepository(server.fetch).put(map);
      expect(stringify).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, map });
    } finally {
      stringify.mockRestore();
    }
  });
});

describe('HTTP read transport', () => {
  it('keeps server summary order rather than sorting again', async () => {
    const server = new MapFetch();
    const summaries = [
      { id: 'b', title: 'B', updatedAt: '2000' },
      { id: 'a', title: 'A', updatedAt: '2026' },
    ];
    server.respondNext(() => Response.json(summaries));
    expect(await new HttpMapRepository(server.fetch).list()).toStrictEqual(summaries);
  });

  it('binds the default fetch to globalThis without making a real request', async () => {
    const server = new MapFetch();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(function (
      this: unknown,
      ...args
    ) {
      expect(this).toBe(globalThis);
      return server.fetch(...args);
    });
    try {
      expect(await new HttpMapRepository().list()).toStrictEqual([]);
      expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/maps', { method: 'GET' });
    } finally {
      fetch.mockRestore();
    }
  });

  it('isolates memory-backed users with the same map id', async () => {
    const alice = new HttpMapRepository(new MapFetch().fetch);
    const bob = new HttpMapRepository(new MapFetch().fetch);
    const map = mapOf(node('r'));
    await alice.put(map);
    expect(await bob.list()).toStrictEqual([]);
    expect(await bob.get(map.id)).toBeUndefined();
    await bob.put({ ...map, title: 'Bob' });
    await bob.delete(map.id);
    expect(await alice.get(map.id)).toStrictEqual(map);
    expect(await bob.get(map.id)).toBeUndefined();
  });
});
