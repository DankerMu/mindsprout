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

export class StorageUnauthorizedError extends Error {
  override readonly name = 'StorageUnauthorizedError';
}

// A stored record was written by a newer schema than this adapter reads (design D7, D8).
export class UnsupportedSchemaVersionError extends Error {
  override readonly name = 'UnsupportedSchemaVersionError';
  readonly found: number;
  readonly supported: number;

  constructor(found: number, supported: number) {
    super(
      `stored schemaVersion ${String(found)} is newer than supported version ${String(supported)}`,
    );
    this.found = found;
    this.supported = supported;
  }
}

// Why a generation failed (design D9 notice table). Map's own vocabulary: map never imports ai.
export type GenerateErrorCode =
  | 'timeout'
  | 'provider-error'
  | 'invalid-output'
  | 'refused'
  | 'ai-unavailable'
  | 'unauthenticated'
  | 'network';

// The fixed message names only the code, so no server diagnostic text can reach it.
export class GenerateError extends Error {
  override readonly name = 'GenerateError';
  readonly code: GenerateErrorCode;

  constructor(code: GenerateErrorCode) {
    super(`generation failed: ${code}`);
    this.code = code;
  }
}
