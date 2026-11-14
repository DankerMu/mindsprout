import { NextResponse } from 'next/server';
import { readCredentials, registerAccount, setSessionCookie } from '@/app/server/account-services';
import { AccountError } from '@/contexts/account/domain/account';
import { logger } from '@/shared/logger';

export async function POST(request: Request): Promise<Response> {
  try {
    const { user, token } = await registerAccount(await readCredentials(request));
    const response = NextResponse.json(
      { username: user.username, isAdmin: user.isAdmin },
      { status: 201 },
    );
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    if (error instanceof AccountError) {
      if (error.code === 'invalid-input') {
        return Response.json({ error: error.code }, { status: 400 });
      }
      if (error.code === 'username-taken') {
        return Response.json({ error: error.code }, { status: 409 });
      }
    }
    logger.error({ event: 'account.register.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
