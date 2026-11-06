import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  StorageUnavailableError,
  TreeOpError,
  UnsupportedSchemaVersionError,
  type TreeOpErrorCode,
} from './errors';

describe('TreeOpError', () => {
  it('carries its code, name and message and is an Error', () => {
    const code: TreeOpErrorCode = 'unknown-node';
    const error = new TreeOpError(code, 'node n1 not found');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TreeOpError);
    expect(error.name).toBe('TreeOpError');
    expect(error.code).toBe('unknown-node');
    expect(error.message).toBe('node n1 not found');
    expect('issues' in error).toBe(false);
  });

  it('keeps a copy of the schema issues it wraps', () => {
    const issues: z.core.$ZodIssue[] = [
      { code: 'custom', path: ['id'], message: 'required', input: undefined },
    ];
    const error = new TreeOpError('invalid-op', 'invalid op', issues);

    expect(error.code).toBe('invalid-op');
    expect(error.issues).toEqual(issues);
    expect(error.issues).not.toBe(issues);
  });
});

describe('StorageUnavailableError', () => {
  it('carries its name and message and is an Error without a cause by default', () => {
    const error = new StorageUnavailableError('IndexedDB could not be opened');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(error.name).toBe('StorageUnavailableError');
    expect(error.message).toBe('IndexedDB could not be opened');
    expect('cause' in error).toBe(false);
  });

  it('passes the underlying failure through as its cause', () => {
    const cause = new Error('SecurityError: the operation is insecure');
    const error = new StorageUnavailableError('IndexedDB could not be opened', { cause });

    expect(error.cause).toBe(cause);
    expectTypeOf(StorageUnavailableError).constructorParameters.toEqualTypeOf<
      [message: string, options?: ErrorOptions]
    >();
  });
});

describe('UnsupportedSchemaVersionError', () => {
  it('carries the found and supported versions and names both in its message', () => {
    const error = new UnsupportedSchemaVersionError(2, 1);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(UnsupportedSchemaVersionError);
    expect(error.name).toBe('UnsupportedSchemaVersionError');
    expect(error.found).toBe(2);
    expect(error.supported).toBe(1);
    expect(error.message).toContain('2');
    expect(error.message).toContain('1');
  });

  it('distinguishes the two numbers in its message', () => {
    const error = new UnsupportedSchemaVersionError(17, 3);

    expect(error.found).toBe(17);
    expect(error.supported).toBe(3);
    expect(error.message).toMatch(/\b17\b/);
    expect(error.message).toMatch(/\b3\b/);
  });
});
