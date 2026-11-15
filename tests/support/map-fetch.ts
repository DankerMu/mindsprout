import type { MapRepository } from '../../src/contexts/map/domain/map-repository';
import { HttpMapRepository } from '../../src/contexts/map/infrastructure/persistence/http-map-repository';
import { InMemoryMapRepository } from '../../src/contexts/map/infrastructure/persistence/in-memory-map-repository';
import { parseMindMap } from '../../src/contexts/map/domain/parse-mind-map';

// Each instance represents one signed-in user's isolated store; no request reaches the network.
export class MapFetch {
  readonly requests: { input: Parameters<typeof fetch>[0]; init?: RequestInit }[] = [];
  readonly #store = new InMemoryMapRepository();
  readonly #responses: (() => Response | Promise<Response>)[] = [];

  respondNext(response: () => Response | Promise<Response>): void {
    this.#responses.push(response);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    this.requests.push({ input, ...(init === undefined ? {} : { init }) });
    const response = this.#responses.shift();
    if (response !== undefined) return response();
    if (typeof input !== 'string' || !(input === '/api/maps' || input.startsWith('/api/maps/'))) {
      throw new Error('MapFetch accepts only relative map requests');
    }
    return this.serve(input, init ?? {});
  };

  private async serve(input: string, init: RequestInit): Promise<Response> {
    const method = init.method ?? 'GET';
    if (input === '/api/maps' && method === 'GET') {
      return Response.json(await this.#store.list());
    }
    const id = decodeURIComponent(input.slice('/api/maps/'.length));
    if (method === 'GET') {
      const map = await this.#store.get(id);
      return map === undefined
        ? Response.json({ error: 'not-found' }, { status: 404 })
        : Response.json({ schemaVersion: 1, map });
    }
    return this.write(id, init);
  }

  private async write(id: string, init: RequestInit): Promise<Response> {
    const method = init.method;
    if (new Headers(init.headers).get('Content-Type') !== 'application/json') {
      return Response.json({ error: 'unsupported-media-type' }, { status: 415 });
    }
    if (method === 'PUT') {
      if (typeof init.body !== 'string') throw new Error('MapFetch expects a JSON string body');
      const envelope = JSON.parse(init.body) as { schemaVersion: number; map: unknown };
      const map = parseMindMap(envelope.map);
      if (envelope.schemaVersion !== 1 || map.id !== id) {
        return Response.json({ error: 'invalid-map' }, { status: 400 });
      }
      await this.#store.put(map);
    } else if (method === 'DELETE') {
      await this.#store.delete(id);
    } else {
      throw new Error(`Unsupported MapFetch method: ${String(method)}`);
    }
    return new Response(null, { status: 204 });
  }
}

export function httpRepository(server: MapFetch): MapRepository {
  return new HttpMapRepository(server.fetch);
}
