import type { NextResponse } from 'next/server';
import postgres from 'postgres';
import { register, resolveSession, signIn } from '@/contexts/account/application/auth';
import { AccountError, type User } from '@/contexts/account/domain/account';
import { CryptoTokenSource, ScryptPasswordHasher } from '@/contexts/account/infrastructure/crypto';
import {
  PostgresSessionRepository,
  PostgresUserRepository,
} from '@/contexts/account/infrastructure/postgres';
import { loadEnv } from '@/shared/env';

const SESSION_COOKIE = 'mindsprout_session';
let ports: Parameters<typeof register>[1] | undefined;

function accountPorts(): Parameters<typeof register>[1] {
  if (ports) return ports;
  const { DATABASE_URL } = loadEnv(process.env);
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required for account services');
  const sql = postgres(DATABASE_URL, { max: 5 });
  ports = {
    users: new PostgresUserRepository(sql),
    sessions: new PostgresSessionRepository(sql),
    hasher: new ScryptPasswordHasher(),
    tokens: new CryptoTokenSource(),
    clock: { now: () => new Date() },
  };
  return ports;
}

export async function readCredentials(request: Request): Promise<Parameters<typeof register>[0]> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AccountError('invalid-input');
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    !('username' in body) ||
    typeof body.username !== 'string' ||
    !('password' in body) ||
    typeof body.password !== 'string'
  ) {
    throw new AccountError('invalid-input');
  }
  return { username: body.username, password: body.password };
}

export function registerAccount(input: Parameters<typeof register>[0]) {
  return register(input, accountPorts());
}

export function signInAccount(input: Parameters<typeof signIn>[0]) {
  return signIn(input, accountPorts());
}

function requestToken(request: Request): string | undefined {
  // First exact-name nonempty value wins; opaque values are never trimmed or decoded.
  for (const pair of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = pair.slice(separator + 1);
    if (value !== '') return value;
  }
  return undefined;
}

export async function resolveRequestUser(request: Request): Promise<User | undefined> {
  const token = requestToken(request);
  if (token === undefined) return undefined;
  return resolveSession(token, accountPorts());
}

export async function requireUser(request: Request): Promise<User | Response> {
  const user = await resolveRequestUser(request);
  return user ?? Response.json({ error: 'unauthenticated' }, { status: 401 });
}

function writeSessionCookie(response: NextResponse, token: string, maxAge: number): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
    secure: loadEnv(process.env).NODE_ENV === 'production',
  });
}

export function setSessionCookie(response: NextResponse, token: string): void {
  writeSessionCookie(response, token, 2592000);
}

export function clearSessionCookie(response: NextResponse): void {
  writeSessionCookie(response, '', 0);
}
