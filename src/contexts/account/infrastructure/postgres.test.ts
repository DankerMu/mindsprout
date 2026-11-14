import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { AccountError } from '../domain/account';
import { PostgresSessionRepository, PostgresUserRepository } from './postgres';

function database() {
  const query = vi
    .fn<(parts: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([]);
  const transaction = vi
    .fn<(parts: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([]);
  const events: string[] = [];
  const begin = vi.fn(async (callback: (tx: TransactionSql) => Promise<unknown>) => {
    events.push('begin');
    try {
      const result = await callback(transaction as unknown as TransactionSql);
      events.push('commit');
      return result;
    } catch (error) {
      events.push('rollback');
      throw error;
    }
  });
  const sql = Object.assign(query, { begin }) as unknown as Sql;
  return { sql, query, transaction, begin, events };
}

const SESSION = {
  userId: '5b1e45b7-37a3-4534-a362-7efb07510526',
  expiresAt: '2026-03-02T12:34:56.789Z',
};
// NIST SHA-256 short-message vector for UTF-8 "abc".
const HASH = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const ROW = {
  id: SESSION.userId,
  username: ' Alice é ',
  is_admin: true,
  created_at: new Date('2026-01-31T12:34:56.789Z'),
  password_hash: 'original',
};
const USER = {
  id: SESSION.userId,
  username: ROW.username,
  isAdmin: true,
  createdAt: '2026-01-31T12:34:56.789Z',
};

function statement(call: [TemplateStringsArray, ...unknown[]] | undefined): string {
  if (!call) throw new Error('Expected a database statement');
  return call[0].join('?').replace(/\s+/g, ' ').trim();
}

describe('PostgresUserRepository', () => {
  it('waits for the registration lock before inserting and returns only public fields', async () => {
    const db = database();
    let release!: (rows: unknown[]) => void;
    const lock = new Promise<unknown[]>((resolve) => {
      release = resolve;
    });
    db.transaction.mockReturnValueOnce(lock).mockResolvedValueOnce([ROW]);
    const result = new PostgresUserRepository(db.sql).register(ROW.username, 'original');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(statement(db.transaction.mock.calls[0])).toBe('select pg_advisory_xact_lock(608259634)');
    expect(db.events).toEqual(['begin']);
    release([]);
    expect(await result).toEqual(USER);
    expect(statement(db.transaction.mock.calls[1])).toContain('not exists (select 1 from users)');
    expect(db.transaction.mock.calls[1]?.slice(1)).toEqual([ROW.username, 'original']);
    expect(db.events).toEqual(['begin', 'commit']);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('maps only the exact username unique constraint to username-taken', async () => {
    const db = database();
    db.transaction
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce({ code: '23505', constraint_name: 'users_username_key' });
    await expect(new PostgresUserRepository(db.sql).register('alice', 'hash')).rejects.toEqual(
      new AccountError('username-taken'),
    );
    expect(db.events).toEqual(['begin', 'rollback']);
  });

  it.each([
    { code: '23505', constraint_name: 'users_single_admin' },
    { code: '23514', constraint_name: 'users_username_key' },
    { code: '23505' },
    new Error('connection lost'),
    null,
    'database unavailable',
  ])('propagates unrelated insertion failure %# unchanged', async (error) => {
    const db = database();
    db.transaction.mockResolvedValueOnce([]).mockRejectedValueOnce(error);
    await expect(new PostgresUserRepository(db.sql).register('alice', 'hash')).rejects.toBe(error);
    expect(db.events).toEqual(['begin', 'rollback']);
  });

  it('does not translate lock or commit failures', async () => {
    const error = { code: '23505', constraint_name: 'users_username_key' };
    const db = database();
    db.transaction.mockRejectedValueOnce(error);
    await expect(new PostgresUserRepository(db.sql).register('alice', 'hash')).rejects.toBe(error);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    db.begin.mockRejectedValueOnce(error);
    await expect(new PostgresUserRepository(db.sql).register('alice', 'hash')).rejects.toBe(error);
  });

  it('finds exact usernames with credentials separate from the public user', async () => {
    const db = database();
    db.query.mockResolvedValueOnce([ROW]);
    const users = new PostgresUserRepository(db.sql);
    expect(await users.findByUsername(ROW.username)).toEqual({
      user: USER,
      passwordHash: 'original',
    });
    expect(db.query.mock.calls[0]?.slice(1)).toEqual([ROW.username]);
    expect(await users.findByUsername('missing')).toBeUndefined();
  });

  it('lists public users in database creation/id order and handles an empty table', async () => {
    const db = database();
    db.query.mockResolvedValueOnce([ROW, { ...ROW, id: 'second', is_admin: false }]);
    const users = new PostgresUserRepository(db.sql);
    expect(await users.list()).toEqual([USER, { ...USER, id: 'second', isAdmin: false }]);
    expect(statement(db.query.mock.calls[0])).toContain('order by created_at asc, id asc');
    expect(await users.list()).toEqual([]);
  });

  it('replaces the locked credential then deletes only that user sessions before commit', async () => {
    const db = database();
    db.transaction.mockResolvedValueOnce([{ password_hash: 'original' }]);
    expect(
      await new PostgresUserRepository(db.sql).replacePasswordAndEndSessions(
        SESSION.userId,
        'replacement',
      ),
    ).toBe(true);
    expect(db.transaction.mock.calls.map(statement)).toEqual([
      'select password_hash from users where id = ? for update',
      'update users set password_hash = ? where id = ?',
      'delete from sessions where user_id = ?',
    ]);
    expect(db.transaction.mock.calls.map((call) => call.slice(1))).toEqual([
      [SESSION.userId],
      ['replacement', SESSION.userId],
      [SESSION.userId],
    ]);
    expect(db.events).toEqual(['begin', 'commit']);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('leaves state unchanged when the replacement target is absent', async () => {
    const db = database();
    expect(
      await new PostgresUserRepository(db.sql).replacePasswordAndEndSessions(
        SESSION.userId,
        'replacement',
      ),
    ).toBe(false);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2])(
    'propagates replacement failure at statement %i without success',
    async (index) => {
      const db = database();
      const error = new Error('database rejected mutation');
      for (let i = 0; i < index; i++)
        db.transaction.mockResolvedValueOnce([{ password_hash: 'original' }]);
      db.transaction.mockRejectedValueOnce(error);
      await expect(
        new PostgresUserRepository(db.sql).replacePasswordAndEndSessions(
          SESSION.userId,
          'replacement',
        ),
      ).rejects.toBe(error);
      expect(db.transaction).toHaveBeenCalledTimes(index + 1);
      expect(db.events).toEqual(['begin', 'rollback']);
    },
  );
});

describe('PostgresSessionRepository', () => {
  it.each([{ rows: [] }, { rows: [{ password_hash: 'replacement' }] }])(
    'refuses absent or replaced credentials without inserting %#',
    async ({ rows }) => {
      const db = database();
      db.transaction.mockResolvedValueOnce(rows);
      expect(
        await new PostgresSessionRepository(db.sql).createIfPasswordHashMatches(
          'abc',
          SESSION,
          'original',
        ),
      ).toBe(false);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(db.query).not.toHaveBeenCalled();
    },
  );

  it('locks the user and stores the SHA-256 vector with exact expiry before commit', async () => {
    const db = database();
    db.transaction.mockResolvedValueOnce([{ password_hash: 'original' }]);
    expect(
      await new PostgresSessionRepository(db.sql).createIfPasswordHashMatches(
        'abc',
        SESSION,
        'original',
      ),
    ).toBe(true);
    expect(statement(db.transaction.mock.calls[0])).toBe(
      'select password_hash from users where id = ? for update',
    );
    expect(db.transaction.mock.calls[0]?.slice(1)).toEqual([SESSION.userId]);
    expect(db.transaction.mock.calls[1]?.slice(1)).toEqual([
      HASH,
      SESSION.userId,
      SESSION.expiresAt,
    ]);
    expect(db.events).toEqual(['begin', 'commit']);
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([0, 1])('propagates issuance failure at statement %i', async (index) => {
    const db = database();
    const error = new Error('write failed');
    if (index) db.transaction.mockResolvedValueOnce([{ password_hash: 'original' }]);
    db.transaction.mockRejectedValueOnce(error);
    await expect(
      new PostgresSessionRepository(db.sql).createIfPasswordHashMatches('abc', SESSION, 'original'),
    ).rejects.toBe(error);
    expect(db.events).toEqual(['begin', 'rollback']);
  });

  it('does not return issuance or replacement success when commit fails', async () => {
    const db = database();
    const error = new Error('commit failed');
    db.begin.mockImplementation(async (callback) => {
      await callback(db.transaction as unknown as TransactionSql);
      throw error;
    });
    db.transaction.mockResolvedValue([{ password_hash: 'original' }]);
    await expect(
      new PostgresSessionRepository(db.sql).createIfPasswordHashMatches('abc', SESSION, 'original'),
    ).rejects.toBe(error);
    await expect(
      new PostgresUserRepository(db.sql).replacePasswordAndEndSessions(
        SESSION.userId,
        'replacement',
      ),
    ).rejects.toBe(error);
  });

  it('resolves only joined public users after the supplied instant, without mutating', async () => {
    const db = database();
    const now = new Date('2000-01-01T00:00:00Z');
    db.query.mockResolvedValueOnce([ROW]);
    const sessions = new PostgresSessionRepository(db.sql);
    expect(await sessions.resolve('abc', now)).toEqual(USER);
    expect(db.query.mock.calls[0]?.slice(1)).toEqual([HASH, now]);
    expect(statement(db.query.mock.calls[0])).toContain(
      'join users on users.id = sessions.user_id',
    );
    expect(statement(db.query.mock.calls[0])).toContain('sessions.expires_at > ?');
    expect(await sessions.resolve('unknown', now)).toBeUndefined();
    expect(db.begin).not.toHaveBeenCalled();
  });

  it('hashes deletion tokens and accepts repeated deletion', async () => {
    const db = database();
    const sessions = new PostgresSessionRepository(db.sql);
    await sessions.delete('abc');
    await sessions.delete('abc');
    expect(db.query.mock.calls.map(statement)).toEqual([
      'delete from sessions where token_hash = ?',
      'delete from sessions where token_hash = ?',
    ]);
    expect(db.query.mock.calls.map((call) => call.slice(1))).toEqual([[HASH], [HASH]]);
  });

  it('propagates nontransactional read and delete failures unchanged', async () => {
    const db = database();
    const error = new Error('connection lost');
    db.query.mockRejectedValue(error);
    const users = new PostgresUserRepository(db.sql);
    const sessions = new PostgresSessionRepository(db.sql);
    await expect(users.findByUsername('alice')).rejects.toBe(error);
    await expect(users.list()).rejects.toBe(error);
    await expect(sessions.resolve('abc', new Date())).rejects.toBe(error);
    await expect(sessions.delete('abc')).rejects.toBe(error);
  });
});
