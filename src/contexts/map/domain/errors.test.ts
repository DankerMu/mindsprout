import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  StorageUnauthorizedError,
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

describe('StorageUnauthorizedError', () => {
  it('identifies an ended session', () => {
    const error = new StorageUnauthorizedError('GET /api/maps returned HTTP 401');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('StorageUnauthorizedError');
    expect(error.message).toBe('GET /api/maps returned HTTP 401');
  });
});
