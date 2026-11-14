import { describe, expect, it, vi } from 'vitest';
import { accountPorts, FakeClock } from '../../../../tests/support/account-ports';
import { AccountError } from '../domain/account';
import { register, resolveSession, signIn, signOut } from './auth';

const INPUT = { username: 'alice', password: ' pAss e\u0301 ' };
const USER = {
  id: 'user-1',
  username: 'alice',
  isAdmin: true,
  createdAt: '2026-01-31T12:34:56.789Z',
};

describe('register', () => {
  it('returns the repository user and creates a thirty-day session without credentials', async () => {
    const ports = accountPorts();
    const result = await register(INPUT, ports);
    expect(result).toStrictEqual({ user: USER, token: 'session-1' });
    expect(await ports.users.list()).toStrictEqual([USER]);
    expect([...ports.sessions.records]).toStrictEqual([
      ['session-1', { userId: 'user-1', expiresAt: '2026-03-02T12:34:56.789Z' }],
    ]);
    const credentials = await ports.users.findByUsername('alice');
    expect(credentials?.passwordHash).toBe('hash-1');
    expect(await ports.hasher.verify(INPUT.password, 'hash-1')).toBe(true);
    expect(await ports.hasher.verify(INPUT.password.trim(), 'hash-1')).toBe(false);
  });
});

describe.each([
  { name: 'register', authenticate: register },
  { name: 'signIn', authenticate: signIn },
])('$name credential bounds', ({ authenticate }) => {
  it.each([
    { username: '', password: 'p' },
    { username: 'a'.repeat(65), password: 'p' },
    { username: '😀'.repeat(32) + 'a', password: 'p' },
    { username: 'a', password: '' },
    { username: 'a', password: 'p'.repeat(257) },
    { username: 'a', password: '😀'.repeat(128) + 'p' },
  ])('rejects out-of-bounds credentials before any port effects: %j', async (input) => {
    const ports = accountPorts();
    const hash = vi.spyOn(ports.hasher, 'hash');
    const find = vi.spyOn(ports.users, 'findByUsername');
    const token = vi.spyOn(ports.tokens, 'sessionToken');
    await expect(authenticate(input, ports)).rejects.toEqual(new AccountError('invalid-input'));
    expect(await ports.users.list()).toEqual([]);
    expect(ports.sessions.records.size).toBe(0);
    expect(hash).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
  });
});

describe('signIn', () => {
  it('issues a fresh session for exact credentials without returning their hash', async () => {
    const ports = accountPorts();
    await register(INPUT, ports);
    ports.clock.instant = '2026-02-01T00:00:00.000Z';
    const result = await signIn(INPUT, ports);
    expect(result).toStrictEqual({ user: USER, token: 'session-2' });
    expect([...ports.sessions.records]).toStrictEqual([
      ['session-1', { userId: 'user-1', expiresAt: '2026-03-02T12:34:56.789Z' }],
      ['session-2', { userId: 'user-1', expiresAt: '2026-03-03T00:00:00.000Z' }],
    ]);
  });
});

it('denies wrong passwords and unknown users identically without issuing a session', async () => {
  const ports = accountPorts();
  await register(INPUT, ports);
  const before = [...ports.sessions.records];
  for (const input of [
    { ...INPUT, password: 'wrong-secret' },
    { ...INPUT, username: 'unknown' },
    { ...INPUT, password: INPUT.password.trim() },
    { ...INPUT, password: INPUT.password.normalize('NFC') },
  ]) {
    await expect(signIn(input, ports)).rejects.toStrictEqual(
      new AccountError('invalid-credentials'),
    );
  }
  expect([...ports.sessions.records]).toStrictEqual(before);
  expect(await ports.users.list()).toStrictEqual([USER]);
});

describe('resolveSession', () => {
  it('uses strict expiry and retains non-sliding sessions at and after the deadline', async () => {
    const ports = accountPorts();
    const { token } = await register(INPUT, ports);
    const before = [...ports.sessions.records];
    expect(await resolveSession(undefined, ports)).toBeUndefined();
    expect(await resolveSession('unknown', ports)).toBeUndefined();
    ports.clock.instant = '2026-03-02T12:34:56.788Z';
    expect(await resolveSession(token, ports)).toStrictEqual(USER);
    expect(await resolveSession(token, ports)).toStrictEqual(USER);
    ports.clock.instant = '2026-03-02T12:34:56.789Z';
    expect(await resolveSession(token, ports)).toBeUndefined();
    ports.clock.instant = '2026-03-02T12:34:56.790Z';
    expect(await resolveSession(token, ports)).toBeUndefined();
    expect([...ports.sessions.records]).toStrictEqual(before);
  });
});

it('signs out only the chosen session and accepts absent, unknown and repeated tokens', async () => {
  const ports = accountPorts();
  const first = await register(INPUT, ports);
  const second = await signIn(INPUT, ports);
  const peer = await register({ username: 'bob', password: 'peer-password' }, ports);
  const before = [...ports.sessions.records];
  await signOut(undefined, ports);
  await signOut('unknown', ports);
  expect([...ports.sessions.records]).toStrictEqual(before);
  await signOut(first.token, ports);
  await signOut(first.token, ports);
  expect(await resolveSession(first.token, ports)).toBeUndefined();
  expect(await resolveSession(second.token, ports)).toStrictEqual(USER);
  expect(await resolveSession(peer.token, ports)).toStrictEqual(peer.user);
  expect([...ports.sessions.records.keys()]).toEqual(['session-2', 'session-3']);
});

it.each([
  { username: 'a', password: 'p' },
  { username: 'a'.repeat(64), password: 'p'.repeat(256) },
  { username: '😀'.repeat(32), password: '😀'.repeat(128) },
  { username: ' ', password: ' ' },
])('accepts exact UTF-16 endpoints for registration and sign-in: %j', async (input) => {
  const ports = accountPorts();
  const registered = await register(input, ports);
  expect(registered.user.username).toBe(input.username);
  expect(await signIn(input, ports)).toStrictEqual({ user: registered.user, token: 'session-2' });
  expect(ports.sessions.records.size).toBe(2);
});

it('keeps case, whitespace and canonically equivalent usernames distinct', async () => {
  const ports = accountPorts();
  const names = ['alice', 'Alice', ' alice', 'alice ', 'é', 'e\u0301'];
  for (const username of names) {
    const result = await register({ username, password: username }, ports);
    expect(result.user.username).toBe(username);
    expect((await signIn({ username, password: username }, ports)).user).toStrictEqual(result.user);
  }
  expect((await ports.users.list()).map((user) => user.username)).toEqual(names);
  await expect(signIn({ username: 'ALICE', password: 'alice' }, ports)).rejects.toEqual(
    new AccountError('invalid-credentials'),
  );
  expect(ports.sessions.records.size).toBe(12);
});

it('preserves the account and sessions when the repository rejects a duplicate', async () => {
  const ports = accountPorts();
  await register(INPUT, ports);
  const before = [...ports.sessions.records];
  await expect(register({ ...INPUT, password: 'replacement' }, ports)).rejects.toEqual(
    new AccountError('username-taken'),
  );
  expect(await ports.users.list()).toStrictEqual([USER]);
  expect([...ports.sessions.records]).toStrictEqual(before);
  expect((await signIn(INPUT, ports)).token).toBe('session-2');
  await expect(signIn({ ...INPUT, password: 'replacement' }, ports)).rejects.toEqual(
    new AccountError('invalid-credentials'),
  );
});

it('leaves identity, creation time and admin assignment to registration persistence', async () => {
  const ports = accountPorts();
  await ports.users.register('existing-admin', await ports.hasher.hash('admin-password'));
  const clock = new FakeClock('2026-02-01T00:00:00.000Z');
  const now = vi.spyOn(clock, 'now');
  const find = vi.spyOn(ports.users, 'findByUsername');
  const list = vi.spyOn(ports.users, 'list');
  const result = await register(INPUT, { ...ports, clock });
  expect(result).toStrictEqual({
    user: { ...USER, id: 'user-2', isAdmin: false },
    token: 'session-1',
  });
  expect(ports.sessions.records.get(result.token)).toStrictEqual({
    userId: 'user-2',
    expiresAt: '2026-03-03T00:00:00.000Z',
  });
  expect(now).toHaveBeenCalledTimes(1);
  expect(find).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});

it('treats malformed stored hashes as credential denials', async () => {
  const ports = accountPorts();
  await ports.users.register(INPUT.username, 'malformed-hash');
  await expect(signIn(INPUT, ports)).rejects.toEqual(new AccountError('invalid-credentials'));
  expect(ports.sessions.records.size).toBe(0);
});

it('cannot resolve a session whose user is absent', async () => {
  const ports = accountPorts();
  await ports.sessions.create('orphan', {
    userId: 'missing-user',
    expiresAt: '2026-03-02T12:34:56.789Z',
  });
  expect(await resolveSession('orphan', ports)).toBeUndefined();
  expect(ports.sessions.records.size).toBe(1);
});

it('does not access ports for missing session tokens', async () => {
  const ports = accountPorts();
  const now = vi.spyOn(ports.clock, 'now');
  const resolve = vi.spyOn(ports.sessions, 'resolve');
  const remove = vi.spyOn(ports.sessions, 'delete');
  expect(await resolveSession(undefined, ports)).toBeUndefined();
  await signOut(undefined, ports);
  expect(now).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(ports.sessions.records.size).toBe(0);
});

describe.each([
  { name: 'register', authenticate: register },
  { name: 'signIn', authenticate: signIn },
])('$name port failures', ({ name, authenticate }) => {
  it.each(['credentials', 'users', 'tokens', 'clock', 'sessions'] as const)(
    'propagates unexpected %s failure unchanged, with no session success',
    async (boundary) => {
      const ports = accountPorts();
      if (name === 'signIn') await register(INPUT, ports);
      const before = [...ports.sessions.records];
      const error = new Error('port unavailable');
      if (boundary === 'credentials') {
        vi.spyOn(ports.hasher, name === 'register' ? 'hash' : 'verify').mockRejectedValue(error);
      } else if (boundary === 'users') {
        vi.spyOn(
          ports.users,
          name === 'register' ? 'register' : 'findByUsername',
        ).mockRejectedValue(error);
      } else if (boundary === 'sessions') {
        vi.spyOn(ports.sessions, 'create').mockRejectedValue(error);
      } else {
        const fail = () => {
          throw error;
        };
        if (boundary === 'tokens') vi.spyOn(ports.tokens, 'sessionToken').mockImplementation(fail);
        else vi.spyOn(ports.clock, 'now').mockImplementation(fail);
      }
      await expect(authenticate(INPUT, ports)).rejects.toBe(error);
      expect([...ports.sessions.records]).toStrictEqual(before);
    },
  );
});

it('retains a registered account when session persistence fails without cross-port rollback', async () => {
  const ports = accountPorts();
  const error = new Error('session unavailable');
  vi.spyOn(ports.sessions, 'create').mockRejectedValue(error);
  await expect(register(INPUT, ports)).rejects.toBe(error);
  expect(await ports.users.list()).toStrictEqual([USER]);
  expect(await ports.hasher.verify(INPUT.password, 'hash-1')).toBe(true);
  expect(ports.sessions.records.size).toBe(0);
});

it.each(['resolve', 'clock', 'delete'] as const)(
  'propagates session %s failures without erasing stored sessions',
  async (boundary) => {
    const ports = accountPorts();
    const { token } = await register(INPUT, ports);
    const before = [...ports.sessions.records];
    const error = new Error('session port unavailable');
    if (boundary === 'clock') {
      vi.spyOn(ports.clock, 'now').mockImplementation(() => {
        throw error;
      });
    } else {
      vi.spyOn(ports.sessions, boundary).mockRejectedValue(error);
    }
    const result = boundary === 'delete' ? signOut(token, ports) : resolveSession(token, ports);
    await expect(result).rejects.toBe(error);
    expect([...ports.sessions.records]).toStrictEqual(before);
  },
);
