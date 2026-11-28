import { describe, expectTypeOf, it } from 'vitest';
import type { GenerateInput, GenerateSource } from './generate-source';
import type { TreeOp } from './tree-op';
import type { NodeId } from './types';

// generate-source.ts is type-only; these assertions are checked by `pnpm typecheck` (tsc), not at runtime.
describe('generate source port', () => {
  it('GenerateInput is exactly the topic and the primary root id', () => {
    expectTypeOf<GenerateInput>().toEqualTypeOf<{ topic: string; rootId: NodeId }>();
  });

  it('GenerateSource streams TreeOps for an input under the caller signal', () => {
    expectTypeOf<keyof GenerateSource>().toEqualTypeOf<'generate'>();
    expectTypeOf<GenerateSource['generate']>().toEqualTypeOf<
      (input: GenerateInput, signal: AbortSignal) => AsyncIterable<TreeOp>
    >();
  });
});
