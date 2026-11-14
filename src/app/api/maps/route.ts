import { mapsForUser, requireUser } from '@/app/server/account-services';
import { logger } from '@/shared/logger';

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    return Response.json(await mapsForUser(user.id).list());
  } catch {
    logger.error({ event: 'map.list.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
