import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher, TokenSource } from '../domain/account';

const PROFILE = 'scrypt$32768$8$1';
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_OPTIONS = {
  N: 32768,
  r: 8,
  p: 1,
  // This profile exceeds Node's default memory ceiling.
  maxmem: 64 * 1024 * 1024,
};

const derive = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);

function decodeCanonical(value: string | undefined, bytes: number): Buffer | undefined {
  if (value?.length !== 4 * Math.ceil(bytes / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === bytes && decoded.toString('base64') === value ? decoded : undefined;
}

function parse(stored: string): { salt: Buffer; key: Buffer } | undefined {
  // Bound allocation before splitting or decoding untrusted stored credentials.
  if (stored.length !== PROFILE.length + 1 + 24 + 1 + 44) return undefined;
  const fields = stored.split('$');
  if (
    fields.length !== 6 ||
    fields[0] !== 'scrypt' ||
    fields[1] !== '32768' ||
    fields[2] !== '8' ||
    fields[3] !== '1'
  )
    return undefined;
  const salt = decodeCanonical(fields[4], SALT_BYTES);
  const key = decodeCanonical(fields[5], KEY_BYTES);
  return salt && key ? { salt, key } : undefined;
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, KEY_BYTES, SCRYPT_OPTIONS);
    return `${PROFILE}$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    try {
      const parsed = parse(stored);
      if (!parsed) return false;
      const key = await derive(password, parsed.salt, KEY_BYTES, SCRYPT_OPTIONS);
      return timingSafeEqual(parsed.key, key);
    } catch {
      return false;
    }
  }
}

export class CryptoTokenSource implements TokenSource {
  sessionToken(): string {
    return randomBytes(32).toString('base64url');
  }

  temporaryPassword(): string {
    return randomBytes(12).toString('base64url');
  }
}
