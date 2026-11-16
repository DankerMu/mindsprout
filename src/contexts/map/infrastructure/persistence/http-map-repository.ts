import { z } from 'zod';
import { SESSION_BINDING_HEADER } from '@/shared/session-binding';
import { StorageUnauthorizedError, UnsupportedSchemaVersionError } from '../../domain/errors';
import { parseMindMap } from '../../domain/parse-mind-map';
import type { MapRepository, MapSummary } from '../../domain/map-repository';
import type { MindMap } from '../../domain/types';

const summariesSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    updatedAt: z.string(),
  }),
);
const envelopeSchema = z.object({ schemaVersion: z.literal(1), map: z.unknown() });
const unsupportedSchema = z.object({
  error: z.literal('unsupported-schema-version'),
  found: z.number(),
});

function mapPath(id: MindMap['id'], method: string): string {
  if (id === '' || id === '.' || id === '..') {
    throw new Error(`${method} /api/maps cannot address map id ${JSON.stringify(id)}`);
  }
  return `/api/maps/${encodeURIComponent(id)}`;
}

function requireSuccess(response: Response, operation: string): void {
  if (!response.ok) throw new Error(`${operation} returned HTTP ${String(response.status)}`);
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`${operation} returned invalid JSON (HTTP ${String(response.status)})`, {
      cause,
    });
  }
}

export class HttpMapRepository implements MapRepository {
  #tail: Promise<void> | undefined;

  constructor(
    private readonly fetchMap: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly binding?: string,
  ) {}

  async list(): Promise<MapSummary[]> {
    const operation = 'GET /api/maps';
    const response = await this.request('/api/maps', { method: 'GET' });
    requireSuccess(response, operation);
    const result = summariesSchema.safeParse(await readJson(response, operation));
    if (!result.success) {
      throw new Error(`${operation} returned invalid summaries (HTTP ${String(response.status)})`);
    }
    return result.data;
  }

  async get(id: MindMap['id']): Promise<MindMap | undefined> {
    const path = mapPath(id, 'GET');
    const operation = `GET ${path} (map "${id}")`;
    const response = await this.request(path, { method: 'GET' });
    if (response.status === 404) return undefined;
    if (response.status === 409) {
      const unsupported = unsupportedSchema.safeParse(await readJson(response, operation));
      if (unsupported.success) throw new UnsupportedSchemaVersionError(unsupported.data.found, 1);
    }
    requireSuccess(response, operation);
    try {
      const envelope = envelopeSchema.parse(await readJson(response, operation));
      return parseMindMap(envelope.map);
    } catch (cause) {
      throw new Error(`${operation} returned an unreadable map (HTTP ${String(response.status)})`, {
        cause,
      });
    }
  }

  async put(map: MindMap): Promise<void> {
    const path = mapPath(map.id, 'PUT');
    const body = JSON.stringify({ schemaVersion: 1, map });
    const response = await this.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: new TextEncoder().encode(body).byteLength <= 60_000,
    });
    requireSuccess(response, `PUT ${path}`);
  }

  async delete(id: MindMap['id']): Promise<void> {
    const path = mapPath(id, 'DELETE');
    const response = await this.request(path, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    requireSuccess(response, `DELETE ${path}`);
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    if (this.binding !== undefined) {
      const headers = new Headers(init.headers);
      headers.set(SESSION_BINDING_HEADER, this.binding);
      init.headers = headers;
    }
    const response =
      this.#tail === undefined
        ? this.fetchResponse(path, init)
        : this.#tail.then(() => this.fetchResponse(path, init));
    const release = (): void => {
      if (this.#tail === tail) this.#tail = undefined;
    };
    const tail = response.then(release, release);
    this.#tail = tail;
    return response;
  }

  private async fetchResponse(path: string, init: RequestInit): Promise<Response> {
    const operation = `${String(init.method)} ${path}`;
    let response: Response;
    try {
      response = await this.fetchMap(path, init);
    } catch (cause) {
      throw new Error(`${operation} request failed`, { cause });
    }
    if (response.status === 401) {
      throw new StorageUnauthorizedError(`${operation} returned HTTP 401`);
    }
    return response;
  }
}
