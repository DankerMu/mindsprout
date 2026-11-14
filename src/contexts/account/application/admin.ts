import {
  AccountError,
  type PasswordHasher,
  type TokenSource,
  type User,
  type UserRepository,
} from '../domain/account';

export async function listUsers(
  actor: User,
  { users }: { users: UserRepository },
): Promise<User[]> {
  if (!actor.isAdmin) throw new AccountError('forbidden');
  return users.list();
}

export async function resetPassword(
  actor: User,
  userId: string,
  { users, hasher, tokens }: { users: UserRepository; hasher: PasswordHasher; tokens: TokenSource },
): Promise<string> {
  if (!actor.isAdmin) throw new AccountError('forbidden');
  const password = tokens.temporaryPassword();
  const hash = await hasher.hash(password);
  const replaced = await users.replacePasswordAndEndSessions(userId, hash);
  if (!replaced) throw new AccountError('not-found');
  return password;
}
