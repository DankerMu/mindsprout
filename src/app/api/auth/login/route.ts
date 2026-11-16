import { NextResponse } from 'next/server';
import {
  readCredentials,
  requireJson,
  setSessionCookie,
  signInAccount,
} from '@/app/server/account-services';
import { AccountError } from '@/contexts/account/domain/account';
import { logger } from '@/shared/logger';

export async function POST(request: Request): Promise<Response> {
  const rejected = requireJson(request);
  if (rejected) return rejected;
  try {
    const { user, token } = await signInAccount(await readCredentials(request));
    const response = NextResponse.json({ username: user.username, isAdmin: user.isAdmin });
    setSessionCookie(response, token, user.username);
    return response;
  } catch (error) {
    if (error instanceof AccountError) {
      if (error.code === 'invalid-input') {
        return Response.json({ error: error.code }, { status: 400 });
      }
      if (error.code === 'invalid-credentials') {
        return Response.json({ error: error.code }, { status: 401 });
      }
    }
    logger.error({ event: 'account.login.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
