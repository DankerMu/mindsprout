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

// The backing store cannot be opened (design D7). Error contract: MapRepository in map-repository.ts.
// An adapter attaches the underlying failure as `cause`. `public`: the constructor narrows Error's
// optional message to a required one, which no-useless-constructor accepts only when marked public.
export class StorageUnavailableError extends Error {
  override readonly name = 'StorageUnavailableError';

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
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
