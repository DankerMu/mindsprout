import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { TreeOpError, type TreeOpErrorCode } from './errors';

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
