import { mapsForUser, requireUser } from '@/app/server/account-services';
import { UnsupportedSchemaVersionError } from '@/contexts/account/acl/map';
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
