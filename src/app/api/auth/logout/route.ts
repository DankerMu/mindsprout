import { NextResponse } from 'next/server';
import { clearSessionCookie, requireJson, signOutRequest } from '@/app/server/account-services';
import { logger } from '@/shared/logger';

export async function POST(request: Request): Promise<Response> {
  const rejected = requireJson(request);
  if (rejected) return rejected;
  try {
    await signOutRequest(request);
    const response = new NextResponse(null, { status: 204 });
    clearSessionCookie(response);
    return response;
  } catch {
    logger.error({ event: 'account.logout.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
