export type AccountErrorCode =
  'invalid-input' | 'username-taken' | 'invalid-credentials' | 'forbidden' | 'not-found';

export class AccountError extends Error {
  override readonly name = 'AccountError';
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface Session {
  userId: string;
  expiresAt: string;
}

export interface UserRepository {
  // Owns id, creation time and first-admin assignment atomically; exact duplicates throw username-taken.
  register(username: string, passwordHash: string): Promise<User>;
  findByUsername(username: string): Promise<{ user: User; passwordHash: string } | undefined>;
  // Oldest-created first; credentials never appear in the list.
  list(): Promise<User[]>;
  // Atomic replacement and target-only session deletion; unknown id returns false without changes.
  replacePasswordAndEndSessions(userId: string, newHash: string): Promise<boolean>;
}

export interface SessionRepository {
  // Atomic credential check and insertion, serialized with password replacement/session deletion.
  // A changed hash or absent user returns false without inserting a session.
  createIfPasswordHashMatches(
    token: string,
    session: Session,
    expectedPasswordHash: string,
  ): Promise<boolean>;
  // Strict expiresAt > now, joined to an existing user; no sliding or expired-row deletion.
  resolve(token: string, now: Date): Promise<User | undefined>;
  delete(token: string): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  // Malformed stored hashes verify false.
  verify(password: string, stored: string): Promise<boolean>;
}

export interface TokenSource {
  // Production draws 32 random bytes, encoded base64url.
  sessionToken(): string;
  // Production draws 16 base64url characters.
  temporaryPassword(): string;
}

export interface Clock {
  now(): Date;
}
