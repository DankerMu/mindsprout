import {
  AccountError,
  type Clock,
  type PasswordHasher,
  type Session,
  type SessionRepository,
  type TokenSource,
  type User,
  type UserRepository,
} from '../../src/contexts/account/domain/account';

export class FakeClock implements Clock {
  constructor(public instant = '2026-01-31T12:34:56.789Z') {}

  now(): Date {
    return new Date(this.instant);
  }
}

class InMemoryUsers implements UserRepository {
  readonly records = new Map<string, { user: User; passwordHash: string }>();

  constructor(
    private readonly clock: Clock,
    private readonly sessions: Map<string, Session>,
  ) {}

  register(username: string, passwordHash: string): Promise<User> {
    if ([...this.records.values()].some((record) => record.user.username === username)) {
      return Promise.reject(new AccountError('username-taken'));
    }
    const user: User = {
      id: `user-${String(this.records.size + 1)}`,
      username,
      isAdmin: this.records.size === 0,
      createdAt: this.clock.now().toISOString(),
    };
    this.records.set(user.id, { user, passwordHash });
    return Promise.resolve({ ...user });
  }

  findByUsername(username: string): Promise<{ user: User; passwordHash: string } | undefined> {
    const record = [...this.records.values()].find((item) => item.user.username === username);
    return Promise.resolve(
      record === undefined
        ? undefined
        : { user: { ...record.user }, passwordHash: record.passwordHash },
    );
  }

  list(): Promise<User[]> {
    return Promise.resolve(
      [...this.records.values()]
        .map(({ user }) => ({ ...user }))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    );
  }

  replacePasswordAndEndSessions(userId: string, newHash: string): Promise<boolean> {
    const record = this.records.get(userId);
    if (record === undefined) return Promise.resolve(false);
    record.passwordHash = newHash;
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(token);
    }
    return Promise.resolve(true);
  }
}

class InMemorySessions implements SessionRepository {
  constructor(
    readonly records: Map<string, Session>,
    private readonly users: InMemoryUsers,
  ) {}

  createIfPasswordHashMatches(
    token: string,
    session: Session,
    expectedPasswordHash: string,
  ): Promise<boolean> {
    const record = this.users.records.get(session.userId);
    if (record?.passwordHash !== expectedPasswordHash) {
      return Promise.resolve(false);
    }
    this.records.set(token, { ...session });
    return Promise.resolve(true);
  }

  resolve(token: string, now: Date): Promise<User | undefined> {
    const session = this.records.get(token);
    if (session === undefined || Date.parse(session.expiresAt) <= now.getTime()) {
      return Promise.resolve(undefined);
    }
    const record = this.users.records.get(session.userId);
    return Promise.resolve(record === undefined ? undefined : { ...record.user });
  }

  delete(token: string): Promise<void> {
    this.records.delete(token);
    return Promise.resolve();
  }
}

// Opaque, instance-local handles model verification, not cryptographic hashing.
class InMemoryPasswordHasher implements PasswordHasher {
  readonly #passwords = new Map<string, string>();

  hash(password: string): Promise<string> {
    const hash = `hash-${String(this.#passwords.size + 1)}`;
    this.#passwords.set(hash, password);
    return Promise.resolve(hash);
  }

  verify(password: string, stored: string): Promise<boolean> {
    return Promise.resolve(this.#passwords.has(stored) && this.#passwords.get(stored) === password);
  }
}

class DeterministicTokens implements TokenSource {
  #sessionCount = 0;
  #passwordCount = 0;

  sessionToken(): string {
    return `session-${String(++this.#sessionCount)}`;
  }

  temporaryPassword(): string {
    return `password${String(++this.#passwordCount).padStart(8, '0')}`;
  }
}

export function accountPorts() {
  const clock = new FakeClock();
  const records = new Map<string, Session>();
  const users = new InMemoryUsers(clock, records);
  return {
    users,
    sessions: new InMemorySessions(records, users),
    hasher: new InMemoryPasswordHasher(),
    tokens: new DeterministicTokens(),
    clock,
  };
}
