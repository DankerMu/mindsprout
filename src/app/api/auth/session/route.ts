import { requireUser } from '@/app/server/account-services';
import { logger } from '@/shared/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    return Response.json({ username: user.username, isAdmin: user.isAdmin });
  } catch {
    logger.error({ event: 'account.session.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
