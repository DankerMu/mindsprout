import { describe, expect, it } from 'vitest';
import { AccountError } from './account';

describe('AccountError', () => {
  it('is an Error with a safe denial discriminant', () => {
    const error = new AccountError('invalid-credentials');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AccountError');
    expect(error.code).toBe('invalid-credentials');
  });
});
