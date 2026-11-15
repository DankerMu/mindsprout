import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AccountServices from '@/app/server/account-services';
import { AccountError, type User } from '@/contexts/account/domain/account';
import { logger } from '@/shared/logger';

const { requireUser, resetAccountPassword } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  resetAccountPassword: vi.fn(),
}));
vi.mock('@/app/server/account-services', async (importOriginal) => ({
  ...(await importOriginal<typeof AccountServices>()),
  requireUser,
  resetAccountPassword,
}));

import { POST } from './route';

const admin: User = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  username: 'owner',
  isAdmin: true,
  createdAt: '2026-11-01T00:00:00.000Z',
};
const target = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function request(contentType: string | null = 'application/json', token?: string): Request {
  const headers = new Headers();
  if (contentType !== null) headers.set('content-type', contentType);
  if (token !== undefined) headers.set('cookie', `mindsprout_session=${token}`);
  return new Request(`http://localhost/api/admin/users/${target}/password-reset`, {
    method: 'POST',
    headers,
  });
}

function context(id = target) {
  const params = vi.fn(() => Promise.resolve({ id }));
  return {
    get params() {
      return params();
    },
    access: params,
  };
}

beforeEach(() => {
  requireUser.mockResolvedValue(admin);
  resetAccountPassword.mockResolvedValue('temporary_secret');
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('POST /api/admin/users/{id}/password-reset', () => {
  it.each([undefined, 'forged', 'expired'])(
    'refuses %s sessions before media, params, body or reset',
    async (token) => {
      const denied = Response.json({ error: 'unauthenticated' }, { status: 401 });
      requireUser.mockResolvedValue(denied);
      const input = request('application/x-www-form-urlencoded', token);
      const json = vi.spyOn(input, 'json');
      const ctx = context();
      const response = await POST(input, ctx);
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(input);
      expect(response).toBe(denied);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
      expect(ctx.access).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(resetAccountPassword).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it.each([target, 'not-a-uuid'])('refuses regular actors before reading target %s', async (id) => {
    requireUser.mockResolvedValue({ ...admin, isAdmin: false });
    const ctx = context(id);
    const response = await POST(request(), ctx);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
    expect(ctx.access).not.toHaveBeenCalled();
    expect(resetAccountPassword).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([null, 'application/x-www-form-urlencoded', 'text/plain', 'application/problem+json'])(
    'refuses media type %s before params or reset',
    async (media) => {
      const input = request(media);
      const json = vi.spyOn(input, 'json');
      const ctx = context();
      const response = await POST(input, ctx);
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(input);
      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toEqual({ error: 'unsupported-media-type' });
      expect(ctx.access).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(resetAccountPassword).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it('checks media before regular-user authorization', async () => {
    requireUser.mockResolvedValue({ ...admin, isAdmin: false });
    const ctx = context('not-a-uuid');
    const response = await POST(request(null), ctx);
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ error: 'unsupported-media-type' });
    expect(ctx.access).not.toHaveBeenCalled();
    expect(resetAccountPassword).not.toHaveBeenCalled();
  });

  it.each([
    'not-a-uuid',
    '',
    'bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb',
    `{${target}}`,
    ` ${target}`,
    `${target}\n`,
    'gggggggg-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ])('refuses malformed target %j before the reset use case', async (id) => {
    const ctx = context(id);
    const response = await POST(request(), ctx);
    expect(ctx.access).toHaveBeenCalledOnce();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not-found' });
    expect(resetAccountPassword).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 403],
    ['not-found', 404],
  ] as const)('maps use-case %s without a cookie or secret', async (code, status) => {
    resetAccountPassword.mockRejectedValue(new AccountError(code));
    const response = await POST(request(), context());
    expect(resetAccountPassword).toHaveBeenCalledExactlyOnceWith(admin, target);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: code });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([target, admin.id, 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB'])(
    'returns only the temporary password for target %s without cookies or logs',
    async (id) => {
      const input = request('Application/JSON; charset=utf-8');
      const json = vi.spyOn(input, 'json');
      const ctx = context(id);
      const response = await POST(input, ctx);
      expect(requireUser).toHaveBeenCalledExactlyOnceWith(input);
      expect(ctx.access).toHaveBeenCalledOnce();
      expect(resetAccountPassword).toHaveBeenCalledExactlyOnceWith(admin, id);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ temporaryPassword: 'temporary_secret' });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(json).not.toHaveBeenCalled();
      expect(input.bodyUsed).toBe(false);
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    },
  );

  it.each(['{', '{"extra":"ignored"}', 'null'])(
    'consumes no payload fields from %s',
    async (body) => {
      const input = new Request(`http://localhost/api/admin/users/${target}/password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      const response = await POST(input, context());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ temporaryPassword: 'temporary_secret' });
      expect(input.bodyUsed).toBe(false);
      expect(resetAccountPassword).toHaveBeenCalledExactlyOnceWith(admin, target);
    },
  );

  it.each([
    'session',
    'params',
    'composition',
    'token',
    'hash',
    'repository',
    'unexpected-account-error',
  ])('returns a safe 500 for %s failure', async (source) => {
    const failure = new Error('temporary_secret private-target private-actor cookie-secret');
    const ctx = context();
    if (source === 'session') requireUser.mockRejectedValue(failure);
    if (source === 'params') ctx.access.mockRejectedValue(failure);
    if (source === 'composition')
      resetAccountPassword.mockImplementation(() => {
        throw failure;
      });
    if (['token', 'hash', 'repository'].includes(source))
      resetAccountPassword.mockRejectedValue(failure);
    if (source === 'unexpected-account-error')
      resetAccountPassword.mockRejectedValue(new AccountError('invalid-input'));
    const response = await POST(request('application/json', 'cookie-secret'), ctx);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal' });
    expect(logger.error).toHaveBeenCalledExactlyOnceWith({
      event: 'account.password-reset.failed',
    });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
    if (source === 'session') expect(ctx.access).not.toHaveBeenCalled();
    if (source === 'session' || source === 'params')
      expect(resetAccountPassword).not.toHaveBeenCalled();
  });

  it.each(['session', 'params', 'composition'])(
    'does not map unexpected %s AccountErrors as use-case outcomes',
    async (source) => {
      const ctx = context();
      if (source === 'session') requireUser.mockRejectedValue(new AccountError('forbidden'));
      if (source === 'params') ctx.access.mockRejectedValue(new AccountError('not-found'));
      if (source === 'composition')
        resetAccountPassword.mockImplementation(() => {
          throw new AccountError('forbidden');
        });
      const response = await POST(request(), ctx);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'internal' });
      expect(logger.error).toHaveBeenCalledExactlyOnceWith({
        event: 'account.password-reset.failed',
      });
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
      if (source === 'session') expect(ctx.access).not.toHaveBeenCalled();
      if (source !== 'composition') expect(resetAccountPassword).not.toHaveBeenCalled();
    },
  );
});
