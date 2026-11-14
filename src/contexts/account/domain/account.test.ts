import { describe, expect, it } from 'vitest';
import { AccountError } from './account';

describe('AccountError', () => {
  it.each([
    'invalid-input',
    'username-taken',
    'invalid-credentials',
    'forbidden',
    'not-found',
  ] as const)('exposes only the safe %s denial', (code) => {
    const error = new AccountError(code);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AccountError');
    expect(error.message).toBe(code);
    expect(error.code).toBe(code);
    expect(Object.keys(error).sort()).toEqual(['code', 'name']);
  });
});
