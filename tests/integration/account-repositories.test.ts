import { randomUUID } from 'node:crypto';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { setupDatabase } from '../../scripts/db-setup.mjs';
import { withScratchDatabase } from '../../scripts/test-database.mjs';
import {
  PostgresSessionRepository,
  PostgresUserRepository,
} from '../../src/contexts/account/infrastructure/postgres';

const app = postgres(process.env.DATABASE_URL ?? '', { max: 1 });
const owner = postgres(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1 });
const users = new PostgresUserRepository(app);
const sessions = new PostgresSessionRepository(app);
const EXPIRY = '2001-02-03T04:05:06.789Z';
const NOW = new Date('2001-02-03T04:05:06.788Z');
const HASH = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

afterAll(async () => {
  await app.end();
  await owner.end();
});

type QueryHook = (text: string, tx: TransactionSql) => Promise<void>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

// Only the transport is wrapped: every statement and transaction still executes in Postgres.
function instrument(sql: Sql, after: QueryHook, before?: QueryHook): Sql {
  const query = (parts: TemplateStringsArray, ...values: (string | number | Date)[]) =>
    sql(parts, ...values);
  const begin = (callback: (tx: TransactionSql) => Promise<unknown>) =>
    sql.begin(async (tx) => {
      const tagged = async (parts: TemplateStringsArray, ...values: (string | number | Date)[]) => {
        const text = parts.join('?').replace(/\s+/g, ' ').trim();
        await before?.(text, tx);
        const rows = await tx(parts, ...values);
        await after(text, tx);
        return rows;
      };
      return callback(tagged as unknown as TransactionSql);
    });
  return Object.assign(query, { begin }) as unknown as Sql;
}

function barrier(sql: Sql, pattern: RegExp) {
  const reached = deferred<string>();
  let resume!: () => void;
  const released = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const client = instrument(sql, async (text, tx) => {
    if (!pattern.test(text)) return;
    const [row] = await tx<[{ xid: string }]>`select txid_current()::text as xid`;
    reached.resolve(row.xid);
    await released;
  });
  return { client, reached: reached.promise, release: resume };
}

async function beforeCompletion<T>(reached: Promise<T>, operation: Promise<unknown>): Promise<T> {
  const timeout = deferred<never>();
  // This deadline fails a broken real-DB schedule; only database locks release the barrier.
  const timer = setTimeout(() => {
    timeout.reject(new Error('Lock barrier was not reached'));
  }, 5000);
  try {
    return await Promise.race([
      reached,
      timeout.promise,
      operation.then(() => {
        throw new Error('Operation completed without reaching its lock barrier');
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function observeWait(
  monitor: Sql,
  holder: number,
  contender: number,
  xid: string,
  kind: 'advisory' | 'transactionid',
  operation: Promise<unknown>,
) {
  const status = { completed: false };
  void operation.then(
    () => {
      status.completed = true;
    },
    () => {
      status.completed = true;
    },
  );
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (status.completed)
      throw new Error('Contender completed without the required database lock wait');
    const rows = await monitor<{ query: string; locktype: string }[]>`
      select activity.query, waiting.locktype from pg_locks waiting
      join pg_stat_activity activity on activity.pid = waiting.pid
      join pg_locks held on held.pid = ${holder} and held.granted
        and held.locktype = waiting.locktype
        and held.transactionid is not distinct from waiting.transactionid
        and held.classid is not distinct from waiting.classid
        and held.objid is not distinct from waiting.objid
        and held.objsubid is not distinct from waiting.objsubid
      where waiting.pid = ${contender} and not waiting.granted
        and waiting.locktype = ${kind} and activity.wait_event_type = 'Lock'
        and ((${kind} = 'transactionid' and waiting.transactionid::text = ${xid})
          or (${kind} = 'advisory' and waiting.classid = 0 and waiting.objid = 608259634 and waiting.objsubid = 1))
    `;
    if (rows.length > 0) {
      expect(rows[0]?.locktype).toBe(kind);
      expect(rows[0]?.query).toMatch(
        kind === 'advisory'
          ? /pg_advisory_xact_lock\(608259634\)/
          : /select password_hash from users where id = \$1 for update/i,
      );
      return;
    }
  }
  throw new Error('Contender did not wait on the holder transaction/target lock before deadline');
}

async function backend(sql: Sql): Promise<number> {
  const [row] = await sql<[{ pid: number }]>`select pg_backend_pid() as pid`;
  return row.pid;
}

async function freshUser(repository = users) {
  return repository.register(randomUUID(), 'original');
}

async function issue(userId: string, token: string = randomUUID(), repository = sessions) {
  expect(
    await repository.createIfPasswordHashMatches(token, { userId, expiresAt: EXPIRY }, 'original'),
  ).toBe(true);
  return token;
}

async function withScratchAccounts(
  operation: (context: {
    app: Sql;
    owner: Sql;
    databaseUrl: string;
    users: PostgresUserRepository;
    sessions: PostgresSessionRepository;
  }) => Promise<void>,
) {
  await withScratchDatabase(
    async ({
      databaseUrl,
      migrationDatabaseUrl,
    }: {
      databaseUrl: string;
      migrationDatabaseUrl: string;
    }) => {
      await setupDatabase({ databaseUrl: migrationDatabaseUrl });
      const app = postgres(databaseUrl, { max: 1 });
      const owner = postgres(migrationDatabaseUrl, { max: 1 });
      try {
        expect(await app`select current_user as name`).toEqual([{ name: 'mindsprout_app' }]);
        await operation({
          app,
          owner,
          databaseUrl,
          users: new PostgresUserRepository(app),
          sessions: new PostgresSessionRepository(app),
        });
      } finally {
        await app.end();
        await owner.end();
      }
    },
  );
}

describe('Postgres account repositories as the application role', () => {
  it('first registrant is admin and second is regular in a bootstrapped scratch database', async () => {
    await withScratchDatabase(
      async ({
        databaseUrl,
        migrationDatabaseUrl,
      }: {
        databaseUrl: string;
        migrationDatabaseUrl: string;
      }) => {
        await setupDatabase({ databaseUrl: migrationDatabaseUrl });
        const sql = postgres(databaseUrl, { max: 1 });
        try {
          expect(await sql`select current_user as name`).toEqual([{ name: 'mindsprout_app' }]);
          const repository = new PostgresUserRepository(sql);
          const first = await repository.register('first', 'first-hash');
          const second = await repository.register('second', 'second-hash');
          expect(first.isAdmin).toBe(true);
          expect(second.isAdmin).toBe(false);
          expect(await repository.list()).toEqual([first, second]);
        } finally {
          await sql.end();
        }
      },
    );
  });

  it('racing first registrations wait on the advisory lock before taking the insert snapshot', async () => {
    await withScratchDatabase(
      async ({
        databaseUrl,
        migrationDatabaseUrl,
      }: {
        databaseUrl: string;
        migrationDatabaseUrl: string;
      }) => {
        await setupDatabase({ databaseUrl: migrationDatabaseUrl });
        const first = postgres(databaseUrl, { max: 1 });
        const second = postgres(databaseUrl, { max: 1 });
        const monitor = postgres(migrationDatabaseUrl, { max: 1 });
        const gate = barrier(first, /pg_advisory_xact_lock/);
        const pending: Promise<unknown>[] = [];
        try {
          expect(await first`select current_user as name`).toEqual([{ name: 'mindsprout_app' }]);
          expect(await second`select current_user as name`).toEqual([{ name: 'mindsprout_app' }]);
          const holder = await backend(first);
          const contender = await backend(second);
          const registrationA = new PostgresUserRepository(gate.client).register('first', 'hash-a');
          pending.push(registrationA);
          const xid = await beforeCompletion(gate.reached, registrationA);
          const registrationB = new PostgresUserRepository(second).register('second', 'hash-b');
          pending.push(registrationB);
          await observeWait(monitor, holder, contender, xid, 'advisory', registrationB);
          gate.release();
          const [a, b] = await Promise.all([registrationA, registrationB]);
          expect(a.isAdmin).toBe(true);
          expect(b.isAdmin).toBe(false);
          expect(await new PostgresUserRepository(first).list()).toEqual([a, b]);
          expect(await first`select count(*)::int as count from users where is_admin`).toEqual([
            { count: 1 },
          ]);
        } finally {
          gate.release();
          await Promise.allSettled(pending);
          await first.end();
          await second.end();
          await monitor.end();
        }
      },
    );
  });

  it('preserves exact username spelling, credentials on duplicate, timestamps and ordered public lists', async () => {
    expect(await app`select current_user as name`).toEqual([{ name: 'mindsprout_app' }]);
    const prefix = randomUUID();
    const names = ['alice', 'Alice', ' alice ', 'é', 'e\u0301'].map((name) => prefix + name);
    const created = [];
    for (const name of names) created.push(await users.register(name, 'original'));
    const [first, second, third] = created;
    if (!first || !second || !third) throw new Error('Expected three registered users');
    const token = await issue(first.id);
    await expect(users.register(first.username, 'impostor')).rejects.toMatchObject({
      name: 'AccountError',
      code: 'username-taken',
    });
    expect(await sessions.resolve(token, NOW)).toEqual(first);
    expect(await users.findByUsername(prefix + 'ALICE')).toBeUndefined();
    for (const user of created) {
      expect(await users.findByUsername(user.username)).toEqual({ user, passwordHash: 'original' });
      expect(Object.keys(user).sort()).toEqual(['createdAt', 'id', 'isAdmin', 'username']);
      const [stored] = await app<
        [{ createdAt: Date }]
      >`select created_at as "createdAt" from users where id = ${user.id}`;
      expect(stored.createdAt).toBeInstanceOf(Date);
      expect(user.createdAt).toBe(stored.createdAt.toISOString());
    }
    // Fixed timestamps make oldest-first and UUID tie ordering independent of execution speed.
    await owner`update users set created_at = '2000-01-01T00:00:00Z' where id in (${third.id}, ${second.id})`;
    await owner`update users set created_at = '2000-01-02T00:00:00Z' where id = ${first.id}`;
    const expected = [third.id, second.id].sort().concat(first.id);
    const ids = new Set(expected);
    const listed = (await users.list()).filter((user) => ids.has(user.id));
    expect(listed.map((user) => user.id)).toEqual(expected);
    expect(listed.map((user) => user.createdAt)).toEqual([
      '2000-01-01T00:00:00.000Z',
      '2000-01-01T00:00:00.000Z',
      '2000-01-02T00:00:00.000Z',
    ]);
    for (const user of listed)
      expect(Object.keys(user).sort()).toEqual(['createdAt', 'id', 'isAdmin', 'username']);
    expect(
      await app`select count(*)::int as count from sessions where user_id = ${first.id}`,
    ).toEqual([{ count: 1 }]);
  });

  it('stores only SHA-256 tokens, refuses stale/absent users and honors strict supplied expiry without purging', async () => {
    const user = await freshUser();
    await issue(user.id, 'abc');
    const before = await app`select * from sessions where user_id = ${user.id}`;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      token_hash: HASH,
      user_id: user.id,
      expires_at: new Date(EXPIRY),
    });
    expect(await app`select token_hash from sessions where token_hash = 'abc'`).toEqual([]);
    expect(
      await sessions.createIfPasswordHashMatches(
        'stale',
        { userId: user.id, expiresAt: EXPIRY },
        'stale',
      ),
    ).toBe(false);
    expect(
      await sessions.createIfPasswordHashMatches(
        'missing',
        { userId: randomUUID(), expiresAt: EXPIRY },
        'original',
      ),
    ).toBe(false);
    expect(await sessions.resolve('unknown', NOW)).toBeUndefined();
    expect(await sessions.resolve('abc', NOW)).toEqual(user);
    expect(await sessions.resolve('abc', new Date(EXPIRY))).toBeUndefined();
    expect(await sessions.resolve('abc', new Date('2001-02-03T04:05:06.790Z'))).toBeUndefined();
    expect(await sessions.resolve('abc', NOW)).toEqual(user);
    expect(await app`select * from sessions where user_id = ${user.id}`).toEqual(before);
  });

  it('user deletion cascades sessions and makes the token unknown in a scratch database', async () => {
    await withScratchAccounts(async ({ app, owner, users, sessions }) => {
      const user = await freshUser(users);
      await issue(user.id, 'abc', sessions);
      expect(await sessions.resolve('abc', NOW)).toEqual(user);
      expect(await app`select token_hash from sessions where user_id = ${user.id}`).toEqual([
        { token_hash: HASH },
      ]);
      await owner`delete from users where id = ${user.id}`;
      expect(await users.findByUsername(user.username)).toBeUndefined();
      expect(await app`select token_hash from sessions where user_id = ${user.id}`).toEqual([]);
      expect(await sessions.resolve('abc', NOW)).toBeUndefined();
    });
  });

  it('deletes only the supplied token idempotently and resets only the target user', async () => {
    await withScratchAccounts(async ({ app, users, sessions }) => {
      const target = await freshUser(users);
      const peer = await freshUser(users);
      const first = await issue(target.id, randomUUID(), sessions);
      const second = await issue(target.id, randomUUID(), sessions);
      const peerToken = await issue(peer.id, randomUUID(), sessions);
      await sessions.delete(first);
      await sessions.delete(first);
      await sessions.delete('unknown');
      expect(await sessions.resolve(first, NOW)).toBeUndefined();
      expect(await sessions.resolve(second, NOW)).toEqual(target);
      expect(await sessions.resolve(peerToken, NOW)).toEqual(peer);
      const third = await issue(target.id, randomUUID(), sessions);
      expect(await users.replacePasswordAndEndSessions(randomUUID(), 'missing')).toBe(false);
      expect(await sessions.resolve(second, NOW)).toEqual(target);
      expect(await users.replacePasswordAndEndSessions(target.id, 'replacement')).toBe(true);
      expect(await sessions.resolve(second, NOW)).toBeUndefined();
      expect(await sessions.resolve(third, NOW)).toBeUndefined();
      expect(await app`select token_hash from sessions where user_id = ${target.id}`).toEqual([]);
      expect(await users.findByUsername(target.username)).toEqual({
        user: target,
        passwordHash: 'replacement',
      });
      expect(await users.findByUsername(peer.username)).toEqual({
        user: peer,
        passwordHash: 'original',
      });
      expect(await sessions.resolve(peerToken, NOW)).toEqual(peer);
    });
  });

  it.each(['reset', 'issuance'] as const)(
    '%s holds the common user lock until its transaction commits',
    async (firstOperation) => {
      await withScratchAccounts(async ({ app, owner, users, sessions, databaseUrl }) => {
        const target = await freshUser(users);
        const peer = await freshUser(users);
        const prior = await issue(target.id, randomUUID(), sessions);
        const peerToken = await issue(peer.id, randomUUID(), sessions);
        const token = randomUUID();
        const first = postgres(databaseUrl, { max: 1 });
        const second = postgres(databaseUrl, { max: 1 });
        const gate = barrier(first, /select password_hash from users/i);
        const pending: Promise<unknown>[] = [];
        try {
          const holder = await backend(first);
          const contender = await backend(second);
          const reset = (sql: Sql) =>
            new PostgresUserRepository(sql).replacePasswordAndEndSessions(target.id, 'replacement');
          const issuance = (sql: Sql) =>
            new PostgresSessionRepository(sql).createIfPasswordHashMatches(
              token,
              { userId: target.id, expiresAt: EXPIRY },
              'original',
            );
          const holding = firstOperation === 'reset' ? reset(gate.client) : issuance(gate.client);
          pending.push(holding);
          const xid = await beforeCompletion(gate.reached, holding);
          const waiting = firstOperation === 'reset' ? issuance(second) : reset(second);
          pending.push(waiting);
          await observeWait(owner, holder, contender, xid, 'transactionid', waiting);
          gate.release();
          expect(await holding).toBe(true);
          expect(await waiting).toBe(firstOperation === 'issuance');
          expect(await users.findByUsername(target.username)).toEqual({
            user: target,
            passwordHash: 'replacement',
          });
          expect(await sessions.resolve(token, NOW)).toBeUndefined();
          expect(await sessions.resolve(prior, NOW)).toBeUndefined();
          expect(await app`select token_hash from sessions where user_id = ${target.id}`).toEqual(
            [],
          );
          expect(await sessions.resolve(peerToken, NOW)).toEqual(peer);
          expect(await users.findByUsername(peer.username)).toEqual({
            user: peer,
            passwordHash: 'original',
          });
        } finally {
          gate.release();
          await Promise.allSettled(pending);
          await first.end();
          await second.end();
        }
      });
    },
  );

  it('propagates real insertion errors without translating constraints or changing sessions', async () => {
    const target = await freshUser();
    const peer = await freshUser();
    const token = await issue(peer.id);
    const before = await app`select * from sessions where user_id in (${target.id}, ${peer.id})`;
    await expect(
      sessions.createIfPasswordHashMatches(
        token,
        { userId: target.id, expiresAt: EXPIRY },
        'original',
      ),
    ).rejects.toMatchObject({ code: '23505', constraint_name: 'sessions_pkey' });
    await expect(
      sessions.createIfPasswordHashMatches(
        randomUUID(),
        { userId: target.id, expiresAt: 'not-a-date' },
        'original',
      ),
    ).rejects.toMatchObject({ code: '22007' });
    await expect(users.register(`invalid\u0000${randomUUID()}`, 'hash')).rejects.toMatchObject({
      code: '22021',
    });
    expect(await app`select * from sessions where user_id in (${target.id}, ${peer.id})`).toEqual(
      before,
    );
    expect(await sessions.resolve(token, NOW)).toEqual(peer);
    expect(await users.findByUsername(target.username)).toEqual({
      user: target,
      passwordHash: 'original',
    });
  });

  it.each(['update users', 'delete from sessions'])(
    'rolls back replacement when %s fails in the real transaction',
    async (failingStatement) => {
      await withScratchAccounts(async ({ app, users, sessions }) => {
        const target = await freshUser(users);
        const peer = await freshUser(users);
        const targetToken = await issue(target.id, randomUUID(), sessions);
        const peerToken = await issue(peer.id, randomUUID(), sessions);
        const client = instrument(
          app,
          async () => {
            await Promise.resolve();
          },
          async (text, tx) => {
            const targetStatement =
              failingStatement === 'update users'
                ? 'update users set password_hash'
                : 'delete from sessions where';
            if (text.startsWith(targetStatement)) await tx`select 1 / 0`;
          },
        );
        await expect(
          new PostgresUserRepository(client).replacePasswordAndEndSessions(
            target.id,
            'replacement',
          ),
        ).rejects.toMatchObject({ code: '22012' });
        expect(await users.findByUsername(target.username)).toEqual({
          user: target,
          passwordHash: 'original',
        });
        expect(await sessions.resolve(targetToken, NOW)).toEqual(target);
        expect(await sessions.resolve(peerToken, NOW)).toEqual(peer);
      });
    },
  );
});
