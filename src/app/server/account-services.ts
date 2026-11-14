import type { NextResponse } from 'next/server';
import postgres from 'postgres';
import type { MapRepository } from '@/contexts/account/acl/map';
import { register, resolveSession, signIn, signOut } from '@/contexts/account/application/auth';
import { AccountError, type User } from '@/contexts/account/domain/account';
import { CryptoTokenSource, ScryptPasswordHasher } from '@/contexts/account/infrastructure/crypto';
import { PostgresMapStore } from '@/contexts/account/infrastructure/map-store';
import {
  PostgresSessionRepository,
  PostgresUserRepository,
} from '@/contexts/account/infrastructure/postgres';
import { loadEnv } from '@/shared/env';

const SESSION_COOKIE = 'mindsprout_session';
// Match HTTP tokens and quoted parameter values, not JSON suffixes or a second media type.
const JSON_MEDIA_TYPE =
  /^[\t ]*application\/json[\t ]*(?:;[\t ]*[!#$%&'*+.^_`|~0-9a-z-]+=(?:[!#$%&'*+.^_`|~0-9a-z-]+|"(?:[\t !#-[\]-~\x80-\xff]|\\[\t !-~\x80-\xff])*")[\t ]*)*$/i;
type AuthPorts = Parameters<typeof register>[1];
let resources: { ports: AuthPorts; maps: PostgresMapStore } | undefined;

function accountResources(): { ports: AuthPorts; maps: PostgresMapStore } {
  if (resources) return resources;
  const { DATABASE_URL } = loadEnv(process.env);
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required for account services');
  const sql = postgres(DATABASE_URL, { max: 5 });
  resources = {
    ports: {
      users: new PostgresUserRepository(sql),
      sessions: new PostgresSessionRepository(sql),
      hasher: new ScryptPasswordHasher(),
      tokens: new CryptoTokenSource(),
      clock: { now: () => new Date() },
    },
    maps: new PostgresMapStore(sql),
  };
  return resources;
}

export function mapsForUser(userId: string): MapRepository {
  return accountResources().maps.forUser(userId);
}

export function requireJson(request: Request): Response | undefined {
  const contentType = request.headers.get('content-type') ?? '';
  if (JSON_MEDIA_TYPE.test(contentType)) return undefined;
  return Response.json({ error: 'unsupported-media-type' }, { status: 415 });
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
  return register(input, accountResources().ports);
}

export function signInAccount(input: Parameters<typeof signIn>[0]) {
  return signIn(input, accountResources().ports);
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
  return resolveSession(token, accountResources().ports);
}

export async function signOutRequest(request: Request): Promise<void> {
  const token = requestToken(request);
  if (token === undefined) return;
  await signOut(token, accountResources().ports);
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
