import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import {
  AccountError,
  type Session,
  type SessionRepository,
  type User,
  type UserRepository,
} from '../domain/account';

type UserRow = { id: string; username: string } & Record<'is_admin', boolean> &
  Record<'created_at', Date>;
type CredentialRow = Record<'password_hash', string>;

function publicUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin,
    createdAt: row.created_at.toISOString(),
  };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function isUsernameConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint_name' in error &&
    error.constraint_name === 'users_username_key'
  );
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly sql: Sql) {}

  async register(username: string, passwordHash: string): Promise<User> {
    return this.sql.begin(async (tx) => {
      // A separate awaited statement gives the INSERT a fresh READ COMMITTED snapshot.
      await tx`select pg_advisory_xact_lock(608259634)`;
      try {
        const [row] = await tx<[UserRow]>`
          insert into users (username, password_hash, is_admin)
          values (${username}, ${passwordHash}, not exists (select 1 from users))
          returning id, username, is_admin, created_at
        `;
        return publicUser(row);
      } catch (error) {
        if (isUsernameConflict(error)) throw new AccountError('username-taken');
        throw error;
      }
    });
  }

  async findByUsername(
    username: string,
  ): Promise<{ user: User; passwordHash: string } | undefined> {
    const [row] = await this.sql<(UserRow & CredentialRow)[]>`
      select id, username, is_admin, created_at, password_hash from users
      where username = ${username}
    `;
    return row ? { user: publicUser(row), passwordHash: row.password_hash } : undefined;
  }

  async list(): Promise<User[]> {
    const rows = await this.sql<UserRow[]>`
      select id, username, is_admin, created_at from users order by created_at asc, id asc
    `;
    return rows.map(publicUser);
  }

  async replacePasswordAndEndSessions(userId: string, newHash: string): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<CredentialRow[]>`
        select password_hash from users where id = ${userId} for update
      `;
      if (!row) return false;
      await tx`update users set password_hash = ${newHash} where id = ${userId}`;
      await tx`delete from sessions where user_id = ${userId}`;
      return true;
    });
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly sql: Sql) {}

  async createIfPasswordHashMatches(
    token: string,
    session: Session,
    expectedPasswordHash: string,
  ): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<CredentialRow[]>`
        select password_hash from users where id = ${session.userId} for update
      `;
      if (row?.password_hash !== expectedPasswordHash) return false;
      await tx`
        insert into sessions (token_hash, user_id, expires_at)
        values (${tokenHash(token)}, ${session.userId}, ${session.expiresAt})
      `;
      return true;
    });
  }

  async resolve(token: string, now: Date): Promise<User | undefined> {
    const [row] = await this.sql<UserRow[]>`
      select users.id, users.username, users.is_admin, users.created_at
      from sessions join users on users.id = sessions.user_id
      where sessions.token_hash = ${tokenHash(token)} and sessions.expires_at > ${now}
    `;
    return row ? publicUser(row) : undefined;
  }

  async delete(token: string): Promise<void> {
    await this.sql`delete from sessions where token_hash = ${tokenHash(token)}`;
  }
}
