import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { accountPorts } from '../../../../tests/support/account-ports';
import {
  AccountError,
  type Clock,
  type PasswordHasher,
  type SessionRepository,
  type TokenSource,
  type UserRepository,
} from '../domain/account';
import { listUsers, resetPassword } from './admin';
import { register, resolveSession, signIn } from './auth';

const ADMIN_INPUT = { username: 'owner', password: 'admin-password' };
const USER_INPUT = { username: 'alice', password: 'user-password' };

async function accounts() {
  const ports = accountPorts();
  const admin = await register(ADMIN_INPUT, ports);
  const user = await register(USER_INPUT, ports);
  return { ports, admin, user };
}

function state(ports: {
  users: { records: ReadonlyMap<string, unknown> };
  sessions: { records: ReadonlyMap<string, unknown> };
}) {
  return structuredClone({
    users: [...ports.users.records],
    sessions: [...ports.sessions.records],
  });
}

function observe(ports: {
  users: UserRepository;
  sessions: SessionRepository;
  hasher: PasswordHasher;
  tokens: TokenSource;
  clock: Clock;
}) {
  return {
    register: vi.spyOn(ports.users, 'register'),
    find: vi.spyOn(ports.users, 'findByUsername'),
    list: vi.spyOn(ports.users, 'list'),
    replace: vi.spyOn(ports.users, 'replacePasswordAndEndSessions'),
    hash: vi.spyOn(ports.hasher, 'hash'),
    verify: vi.spyOn(ports.hasher, 'verify'),
    temporary: vi.spyOn(ports.tokens, 'temporaryPassword'),
    token: vi.spyOn(ports.tokens, 'sessionToken'),
    create: vi.spyOn(ports.sessions, 'createIfPasswordHashMatches'),
    resolve: vi.spyOn(ports.sessions, 'resolve'),
    remove: vi.spyOn(ports.sessions, 'delete'),
    now: vi.spyOn(ports.clock, 'now'),
  };
}

function expectOneReplacement(
  calls: { temporary: MockInstance; hash: MockInstance; replace: MockInstance },
  userId: string,
) {
  expect(calls.temporary).toHaveBeenCalledExactlyOnceWith();
  expect(calls.hash).toHaveBeenCalledExactlyOnceWith('password00000001');
  expect(calls.replace).toHaveBeenCalledExactlyOnceWith(userId, 'hash-3');
  expect(calls.temporary).toHaveBeenCalledBefore(calls.hash);
  expect(calls.hash).toHaveBeenCalledBefore(calls.replace);
  for (const [name, call] of Object.entries(calls)) {
    if (!['temporary', 'hash', 'replace'].includes(name)) expect(call).not.toHaveBeenCalled();
  }
}

describe('listUsers', () => {
  it('refuses a non-admin before any port operation', async () => {
    const { ports, user } = await accounts();
    const before = state(ports);
    const calls = observe(ports);
    const result = listUsers(user.user, ports);
    await expect(result).rejects.toBeInstanceOf(AccountError);
    await expect(result).rejects.toMatchObject({ code: 'forbidden' });
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
    expect(state(ports)).toStrictEqual(before);
  });

  it('returns oldest-first public accounts without credentials or application reordering', async () => {
    const ports = accountPorts();
    const { user: admin } = await register(
      { username: 'z-owner', password: 'admin-secret' },
      ports,
    );
    ports.clock.instant = '2026-02-02T00:00:00.000Z';
    await register({ username: 'a-later', password: 'later-secret' }, ports);
    ports.clock.instant = '2026-02-01T00:00:00.000Z';
    await register({ username: 'm-earlier', password: 'earlier-secret' }, ports);
    const calls = observe(ports);
    expect(await listUsers(admin, ports)).toStrictEqual([
      { id: 'user-1', username: 'z-owner', isAdmin: true, createdAt: '2026-01-31T12:34:56.789Z' },
      {
        id: 'user-3',
        username: 'm-earlier',
        isAdmin: false,
        createdAt: '2026-02-01T00:00:00.000Z',
      },
      { id: 'user-2', username: 'a-later', isAdmin: false, createdAt: '2026-02-02T00:00:00.000Z' },
    ]);
    expect(calls.list).toHaveBeenCalledExactlyOnceWith();
    for (const [name, call] of Object.entries(calls)) {
      if (name !== 'list') expect(call).not.toHaveBeenCalled();
    }
  });

  it('propagates repository failure unchanged', async () => {
    const { ports, admin } = await accounts();
    const error = new Error('listing unavailable');
    vi.spyOn(ports.users, 'list').mockRejectedValue(error);
    await expect(listUsers(admin.user, ports)).rejects.toBe(error);
  });
});

describe('resetPassword', () => {
  it.each(['self', 'other', 'unknown'] as const)(
    'refuses non-admin reset of %s before any port operation or state change',
    async (target) => {
      const { ports, admin, user } = await accounts();
      const id = target === 'self' ? user.user.id : target === 'other' ? admin.user.id : 'missing';
      const before = state(ports);
      const calls = observe(ports);
      const result = resetPassword(user.user, id, ports);
      await expect(result).rejects.toBeInstanceOf(AccountError);
      await expect(result).rejects.toMatchObject({ code: 'forbidden' });
      for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
      expect(state(ports)).toStrictEqual(before);
      expect(await resolveSession(admin.token, ports)).toStrictEqual(admin.user);
      expect(await resolveSession(user.token, ports)).toStrictEqual(user.user);
      expect((await signIn(ADMIN_INPUT, ports)).user).toStrictEqual(admin.user);
      expect((await signIn(USER_INPUT, ports)).user).toStrictEqual(user.user);
    },
  );

  it.each(['other', 'self'] as const)(
    'replaces the %s credential once and revokes only that account’s sessions',
    async (target) => {
      const { ports, admin, user } = await accounts();
      const subject = target === 'self' ? admin : user;
      const peer = target === 'self' ? user : admin;
      const input = target === 'self' ? ADMIN_INPUT : USER_INPUT;
      const peerInput = target === 'self' ? USER_INPUT : ADMIN_INPUT;
      const second = await signIn(input, ports);
      const peerBefore = structuredClone(ports.users.records.get(peer.user.id));
      const calls = observe(ports);

      const password = await resetPassword(admin.user, subject.user.id, ports);

      expect(password).toBe('password00000001');
      expect(password).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expectOneReplacement(calls, subject.user.id);
      expect(ports.users.records.get(subject.user.id)).toStrictEqual({
        user: subject.user,
        passwordHash: 'hash-3',
      });
      expect(JSON.stringify(state(ports))).not.toContain(password);
      expect(ports.users.records.get(peer.user.id)).toStrictEqual(peerBefore);
      expect([...ports.sessions.records.keys()]).toStrictEqual([peer.token]);
      expect(await resolveSession(subject.token, ports)).toBeUndefined();
      expect(await resolveSession(second.token, ports)).toBeUndefined();
      expect(await resolveSession(peer.token, ports)).toStrictEqual(peer.user);
      await expect(signIn(input, ports)).rejects.toMatchObject({ code: 'invalid-credentials' });
      const authenticated = await signIn({ ...input, password }, ports);
      expect(authenticated.user).toStrictEqual(subject.user);
      expect(await resolveSession(authenticated.token, ports)).toStrictEqual(subject.user);
      expect((await signIn(peerInput, ports)).user).toStrictEqual(peer.user);
      expect(await ports.hasher.verify(password, 'hash-3')).toBe(true);
      expect(await ports.hasher.verify(input.password, 'hash-3')).toBe(false);
    },
  );

  it('reports an unknown target only from one atomic replacement without changing state', async () => {
    const { ports, admin, user } = await accounts();
    const before = state(ports);
    const calls = observe(ports);
    const result = resetPassword(admin.user, 'missing', ports);
    await expect(result).rejects.toBeInstanceOf(AccountError);
    await expect(result).rejects.toMatchObject({ code: 'not-found' });
    expectOneReplacement(calls, 'missing');
    expect(state(ports)).toStrictEqual(before);
    expect(await resolveSession(admin.token, ports)).toStrictEqual(admin.user);
    expect(await resolveSession(user.token, ports)).toStrictEqual(user.user);
    expect((await signIn(ADMIN_INPUT, ports)).user).toStrictEqual(admin.user);
    expect((await signIn(USER_INPUT, ports)).user).toStrictEqual(user.user);
    await expect(
      signIn({ ...USER_INPUT, password: 'password00000001' }, ports),
    ).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
  });

  it.each(['token', 'hash', 'replacement'] as const)(
    'propagates %s failure unchanged without calling later ports',
    async (boundary) => {
      const { ports, admin, user } = await accounts();
      const before = state(ports);
      const calls = observe(ports);
      const error = new Error('reset port unavailable');
      if (boundary === 'token') {
        calls.temporary.mockImplementation(() => {
          throw error;
        });
      } else if (boundary === 'hash') calls.hash.mockRejectedValue(error);
      else calls.replace.mockRejectedValue(error);

      await expect(resetPassword(admin.user, user.user.id, ports)).rejects.toBe(error);

      expect(calls.temporary).toHaveBeenCalledExactlyOnceWith();
      if (boundary === 'token') expect(calls.hash).not.toHaveBeenCalled();
      else expect(calls.hash).toHaveBeenCalledExactlyOnceWith('password00000001');
      if (boundary === 'replacement') expectOneReplacement(calls, user.user.id);
      else expect(calls.replace).not.toHaveBeenCalled();
      expect(calls.find).not.toHaveBeenCalled();
      expect(calls.list).not.toHaveBeenCalled();
      expect(state(ports)).toStrictEqual(before);
    },
  );
});
