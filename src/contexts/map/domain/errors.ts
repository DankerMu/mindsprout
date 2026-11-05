import type { z } from 'zod';

// Rejection codes of the TreeOp protocol (design D2 rejection table).
export type TreeOpErrorCode =
  'invalid-op' | 'unknown-node' | 'primary-root-protected' | 'cycle' | 'invalid-target';

export class TreeOpError extends Error {
  override readonly name = 'TreeOpError';
  readonly code: TreeOpErrorCode;
  // `declare`: no class-field initialiser, so the key is absent (not undefined) when no issues are wrapped.
  declare readonly issues?: z.core.$ZodIssue[];

  constructor(code: TreeOpErrorCode, message: string, issues?: readonly z.core.$ZodIssue[]) {
    super(message);
    this.code = code;
    if (issues !== undefined) {
      this.issues = [...issues];
    }
  }
}
