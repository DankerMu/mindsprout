import { listAccounts, requireUser } from '@/app/server/account-services';
import { AccountError } from '@/contexts/account/domain/account';
import { logger } from '@/shared/logger';

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    if (!user.isAdmin) return Response.json({ error: 'forbidden' }, { status: 403 });
    const accounts = listAccounts(user);
    try {
      return Response.json(await accounts);
    } catch (error) {
      if (error instanceof AccountError && error.code === 'forbidden') {
        return Response.json({ error: 'forbidden' }, { status: 403 });
      }
      throw error;
    }
  } catch {
    logger.error({ event: 'account.list.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
