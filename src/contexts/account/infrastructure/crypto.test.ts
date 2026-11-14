import assert from 'node:assert/strict';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CryptoTokenSource, ScryptPasswordHasher } from './crypto';

// Derivation and comparison delegate to Node except in failure tests.
vi.mock('node:crypto', { spy: true });
afterEach(() => vi.resetAllMocks());

// Generated independently with Node scryptSync before this adapter existed: salt bytes 00..0f.
const PASSWORD = ' p\0w😀 ';
const SALT = 'AAECAwQFBgcICQoLDA0ODw==';
const REFERENCE_DERIVED_BYTES = 's8VdVG2/UVhxz1xbDyXE+TmvlobDi7G13CxGXDf6Xr4=';
const REFERENCE = `scrypt$32768$8$1$${SALT}$${REFERENCE_DERIVED_BYTES}`;
const hasher = new ScryptPasswordHasher();

function credential(salt = SALT, key = REFERENCE_DERIVED_BYTES): string {
  return `scrypt$32768$8$1$${salt}$${key}`;
}

describe('ScryptPasswordHasher', () => {
  it('stores salted credentials rather than plaintext and accepts only the password', async () => {
    const stored = await hasher.hash('pw');
    const fields = stored.split('$');
    expect(fields).toHaveLength(6);
    expect(fields.slice(0, 4)).toEqual(['scrypt', '32768', '8', '1']);
    expect(fields).not.toContain('pw');
    expect(fields[4]).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(fields[5]).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    assert(fields[4] !== undefined);
    assert(fields[5] !== undefined);
    expect(Buffer.from(fields[4], 'base64')).toHaveLength(16);
    expect(Buffer.from(fields[5], 'base64')).toHaveLength(32);
    await expect(hasher.verify('pw', stored)).resolves.toBe(true);
    await expect(hasher.verify('px', stored)).resolves.toBe(false);
    expect(scrypt).toHaveBeenCalledWith(
      'pw',
      expect.any(Buffer),
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      expect.any(Function),
    );
  });

  it('draws distinct salts while both hashes verify the exact input', async () => {
    const first = await hasher.hash(PASSWORD);
    const second = await hasher.hash(PASSWORD);
    expect(first).not.toContain(PASSWORD);
    expect(second).not.toContain(PASSWORD);
    expect(first.split('$')[4]).not.toBe(second.split('$')[4]);
    await expect(hasher.verify(PASSWORD, first)).resolves.toBe(true);
    await expect(hasher.verify(PASSWORD, second)).resolves.toBe(true);
    expect(randomBytes).toHaveBeenNthCalledWith(1, 16);
    expect(randomBytes).toHaveBeenNthCalledWith(2, 16);
  });

  it('matches the independent UTF-8 reference with canonical padding', async () => {
    await expect(hasher.verify(PASSWORD, REFERENCE)).resolves.toBe(true);
    for (const password of ['p\0w😀 ', ' p\0w😀', ' pw😀 ', ' p\0w😁 ']) {
      await expect(hasher.verify(password, REFERENCE)).resolves.toBe(false);
    }
    vi.mocked(randomBytes).mockImplementationOnce(() => Buffer.from(SALT, 'base64'));
    await expect(hasher.hash(PASSWORD)).resolves.toBe(REFERENCE);
  });

  it('keeps canonically equivalent Unicode passwords distinct', async () => {
    const stored = await hasher.hash(' e\u0301\0 ');
    await expect(hasher.verify(' e\u0301\0 ', stored)).resolves.toBe(true);
    await expect(hasher.verify(' é\0 ', stored)).resolves.toBe(false);
  });

  it('compares decoded 32-byte keys for both matches and mismatches', async () => {
    await expect(hasher.verify(PASSWORD, REFERENCE)).resolves.toBe(true);
    await expect(hasher.verify('wrong', REFERENCE)).resolves.toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);
    for (const [left, right] of vi.mocked(timingSafeEqual).mock.calls) {
      expect(Buffer.isBuffer(left)).toBe(true);
      expect(Buffer.isBuffer(right)).toBe(true);
      expect(left.byteLength).toBe(32);
      expect(right.byteLength).toBe(32);
    }
  });
});

const malformed = [
  '',
  'not-a-hash',
  REFERENCE.replace('scrypt', 'argon2'),
  REFERENCE.slice(0, REFERENCE.lastIndexOf('$')),
  `${REFERENCE}$extra`,
  REFERENCE.replace('$32768$', '$327$68'),
  REFERENCE.replace('$32768$', '_32768_'),
  credential(REFERENCE_DERIVED_BYTES, SALT),
  ...[
    '16384',
    '65536',
    '0',
    '-32768',
    '32768.0',
    '032768',
    '+32768',
    '3.2768e4',
    ' 32768',
    '32768\n',
    '9007199254740993',
    '9'.repeat(10000),
  ].map((n) => REFERENCE.replace('$32768$', `$${n}$`)),
  ...['0', '16', '-8', '08', '8.0', '9007199254740993'].map((r) =>
    REFERENCE.replace('$8$', `$${r}$`),
  ),
  ...['0', '2', '-1', '01', '1.0', '9007199254740993'].map((p) =>
    REFERENCE.replace('$1$', `$${p}$`),
  ),
  ...[
    '',
    SALT.slice(0, -2),
    `${SALT}=`,
    `${SALT.slice(0, -1)}A`,
    `=${SALT.slice(1)}`,
    `!${SALT.slice(1)}`,
    ` ${SALT.slice(1)}`,
    `-${SALT.slice(1)}`,
    `_${SALT.slice(1)}`,
    `${SALT.slice(0, -1)}\n`,
    'AAECAwQFBgcICQoLDA0ODx==',
    Buffer.alloc(15).toString('base64'),
    Buffer.alloc(17).toString('base64'),
    'A'.repeat(10000),
  ].map((salt) => credential(salt)),
  ...[
    '',
    REFERENCE_DERIVED_BYTES.slice(0, -1),
    `${REFERENCE_DERIVED_BYTES}=`,
    `${REFERENCE_DERIVED_BYTES.slice(0, -1)}A`,
    `=${REFERENCE_DERIVED_BYTES.slice(1)}`,
    `!${REFERENCE_DERIVED_BYTES.slice(1)}`,
    ` ${REFERENCE_DERIVED_BYTES.slice(1)}`,
    REFERENCE_DERIVED_BYTES.replace('/', '_'),
    REFERENCE_DERIVED_BYTES.replace('+', '-'),
    `${REFERENCE_DERIVED_BYTES.slice(0, -1)}\n`,
    's8VdVG2/UVhxz1xbDyXE+TmvlobDi7G13CxGXDf6Xr5=',
    Buffer.alloc(31).toString('base64'),
    Buffer.alloc(33).toString('base64'),
    'A'.repeat(10000),
  ].map((key) => credential(SALT, key)),
];

it.each(malformed.map((stored, index) => ({ stored, index })))(
  'refuses malformed credential $index without derivation or comparison',
  async ({ stored }) => {
    await expect(hasher.verify(PASSWORD, stored)).resolves.toBe(false);
    expect(scrypt).not.toHaveBeenCalled();
    expect(timingSafeEqual).not.toHaveBeenCalled();
  },
);

describe('crypto failures', () => {
  it('turns asynchronous verification failure into a credential refusal', async () => {
    vi.mocked(scrypt).mockImplementationOnce((_password, _salt, _length, _options, callback) => {
      callback(new Error('derivation unavailable'), Buffer.alloc(0));
    });
    await expect(hasher.verify(PASSWORD, REFERENCE)).resolves.toBe(false);
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  it('turns synchronous verification setup failure into a credential refusal', async () => {
    vi.mocked(scrypt).mockImplementationOnce(() => {
      throw new Error('setup unavailable');
    });
    await expect(hasher.verify(PASSWORD, REFERENCE)).resolves.toBe(false);
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  it('propagates asynchronous hashing failures unchanged', async () => {
    const error = new Error('derivation unavailable');
    vi.mocked(scrypt).mockImplementationOnce((_password, _salt, _length, _options, callback) => {
      callback(error, Buffer.alloc(0));
    });
    await expect(hasher.hash(PASSWORD)).rejects.toBe(error);
  });

  it('propagates synchronous hashing setup failures unchanged', async () => {
    const error = new Error('setup unavailable');
    vi.mocked(scrypt).mockImplementationOnce(() => {
      throw error;
    });
    await expect(hasher.hash(PASSWORD)).rejects.toBe(error);
  });

  it('propagates failed salt generation unchanged', async () => {
    const error = new Error('randomness unavailable');
    vi.mocked(randomBytes).mockImplementationOnce(() => {
      throw error;
    });
    await expect(hasher.hash(PASSWORD)).rejects.toBe(error);
  });
});

describe('CryptoTokenSource', () => {
  const tokens = new CryptoTokenSource();
  it.each([
    { method: 'sessionToken' as const, bytes: 32, characters: 43 },
    { method: 'temporaryPassword' as const, bytes: 12, characters: 16 },
  ])('draws full-width distinct $method values', ({ method, bytes, characters }) => {
    const first = tokens[method]();
    const second = tokens[method]();
    for (const token of [first, second]) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token).toHaveLength(characters);
      expect(Buffer.from(token, 'base64url')).toHaveLength(bytes);
      expect(Buffer.from(token, 'base64url').toString('base64url')).toBe(token);
    }
    expect(first).not.toBe(second);
    expect(randomBytes).toHaveBeenNthCalledWith(1, bytes);
    expect(randomBytes).toHaveBeenNthCalledWith(2, bytes);
  });

  it.each(['sessionToken', 'temporaryPassword'] as const)(
    'propagates unavailable randomness for %s without a fallback',
    (method) => {
      const error = new Error('randomness unavailable');
      vi.mocked(randomBytes).mockImplementationOnce(() => {
        throw error;
      });
      expect(() => tokens[method]()).toThrow(error);
    },
  );
});
