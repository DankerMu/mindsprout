import { mapsForUser, requireJson, requireUser } from '@/app/server/account-services';
import { UnsupportedSchemaVersionError } from '@/contexts/account/acl/map';
import { parseMindMap } from '@/contexts/map/domain/parse-mind-map';
import type { MindMap } from '@/contexts/map/domain/types';
import { logger } from '@/shared/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const { id } = await params;
    const map = await mapsForUser(user.id).get(id);
    if (map === undefined) return Response.json({ error: 'not-found' }, { status: 404 });
    return Response.json({ schemaVersion: 1, map });
  } catch (error) {
    if (error instanceof UnsupportedSchemaVersionError) {
      return Response.json(
        { error: 'unsupported-schema-version', found: error.found },
        { status: 409 },
      );
    }
    logger.error({ event: 'map.get.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}

const MAX_BODY_BYTES = 1048576;

async function readMapBody(request: Request): Promise<string | Response> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return Response.json({ error: 'too-large' }, { status: 413 });
  }
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        return Response.json({ error: 'too-large' }, { status: 413 });
      }
      try {
        text += decoder.decode(chunk.value, { stream: true });
      } catch {
        return Response.json({ error: 'invalid-map' }, { status: 400 });
      }
      chunk = await reader.read();
    }
    try {
      return text + decoder.decode();
    } catch {
      return Response.json({ error: 'invalid-map' }, { status: 400 });
    }
  } finally {
    reader.releaseLock();
  }
}

function parseMapEnvelope(text: string, id: string): MindMap | undefined {
  try {
    const envelope: unknown = JSON.parse(text);
    if (typeof envelope !== 'object' || envelope === null || !('map' in envelope)) return;
    const map = parseMindMap(envelope.map);
    if (!('schemaVersion' in envelope) || envelope.schemaVersion !== 1 || map.id !== id) return;
    return map;
  } catch {
    // Only JSON and map validation run here; storage failures remain internal errors.
    return;
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const refused = requireJson(request);
    if (refused) return refused;
    const text = await readMapBody(request);
    if (text instanceof Response) return text;
    const { id } = await params;
    const map = parseMapEnvelope(text, id);
    if (!map) return Response.json({ error: 'invalid-map' }, { status: 400 });
    await mapsForUser(user.id).put(map);
    return new Response(null, { status: 204 });
  } catch {
    logger.error({ event: 'map.put.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const refused = requireJson(request);
    if (refused) return refused;
    const { id } = await params;
    await mapsForUser(user.id).delete(id);
    return new Response(null, { status: 204 });
  } catch {
    logger.error({ event: 'map.delete.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
