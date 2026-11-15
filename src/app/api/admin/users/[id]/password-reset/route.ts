import { requireJson, requireUser, resetAccountPassword } from '@/app/server/account-services';
import { AccountError } from '@/contexts/account/domain/account';
import { logger } from '@/shared/logger';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resetResponse(result: Promise<string>): Promise<Response> {
  try {
    return Response.json({ temporaryPassword: await result });
  } catch (error) {
    if (error instanceof AccountError) {
      if (error.code === 'forbidden') return Response.json({ error: 'forbidden' }, { status: 403 });
      if (error.code === 'not-found') return Response.json({ error: 'not-found' }, { status: 404 });
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const mediaError = requireJson(request);
    if (mediaError) return mediaError;
    if (!user.isAdmin) return Response.json({ error: 'forbidden' }, { status: 403 });
    const { id } = await context.params;
    if (id.length !== 36 || !UUID.test(id)) {
      return Response.json({ error: 'not-found' }, { status: 404 });
    }
    return await resetResponse(resetAccountPassword(user, id));
  } catch {
    logger.error({ event: 'account.password-reset.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
