import {
  AccountError,
  type Clock,
  type PasswordHasher,
  type SessionRepository,
  type TokenSource,
  type User,
  type UserRepository,
} from '../domain/account';

interface Credentials {
  username: string;
  password: string;
}

interface AuthPorts {
  users: UserRepository;
  sessions: SessionRepository;
  hasher: PasswordHasher;
  tokens: TokenSource;
  clock: Clock;
}

export async function register(
  input: Credentials,
  ports: AuthPorts,
): Promise<{ user: User; token: string }> {
  validateCredentials(input);
  const hash = await ports.hasher.hash(input.password);
  const user = await ports.users.register(input.username, hash);
  const result = await createSession(user, hash, ports);
  if (result === undefined) throw new Error('Registration session issuance refused');
  return result;
}

async function createSession(
  user: User,
  expectedPasswordHash: string,
  { sessions, tokens, clock }: AuthPorts,
) {
  const token = tokens.sessionToken();
  const expiresAt = new Date(clock.now().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const created = await sessions.createIfPasswordHashMatches(
    token,
    { userId: user.id, expiresAt },
    expectedPasswordHash,
  );
  if (!created) return undefined;
  return { user, token };
}

function validateCredentials({ username, password }: Credentials): void {
  if (username.length < 1 || username.length > 64 || password.length < 1 || password.length > 256) {
    throw new AccountError('invalid-input');
  }
}

export async function signIn(
  input: Credentials,
  ports: AuthPorts,
): Promise<{ user: User; token: string }> {
  validateCredentials(input);
  const record = await ports.users.findByUsername(input.username);
  if (record === undefined || !(await ports.hasher.verify(input.password, record.passwordHash))) {
    throw new AccountError('invalid-credentials');
  }
  const result = await createSession(record.user, record.passwordHash, ports);
  if (result === undefined) throw new AccountError('invalid-credentials');
  return result;
}

export async function resolveSession(
  token: string | undefined,
  { sessions, clock }: { sessions: SessionRepository; clock: Clock },
): Promise<User | undefined> {
  if (token === undefined) return undefined;
  return sessions.resolve(token, clock.now());
}

export async function signOut(
  token: string | undefined,
  { sessions }: { sessions: SessionRepository },
): Promise<void> {
  if (token !== undefined) await sessions.delete(token);
}
