import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  if (request.cookies.has('mindsprout_session')) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl, 307);
}

export const config = {
  matcher: '/((?!_next/static|_next/image|icon\\.svg$|api/|login$|register$|native-auth/).*)',
};
