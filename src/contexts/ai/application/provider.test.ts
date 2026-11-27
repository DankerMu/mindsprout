import { describe, expectTypeOf, it } from 'vitest';
import type { NodeId, TreeOp } from '../acl/map';
import type { GenerateRequest, Provider } from './provider';

// provider.ts is type-only; these assertions are checked by `pnpm typecheck` (tsc), not at runtime.
describe('Provider port', () => {
  it('GenerateRequest is exactly the topic, the primary root id and an abort signal', () => {
    expectTypeOf<GenerateRequest>().toEqualTypeOf<{
      topic: string;
      rootId: NodeId;
      signal: AbortSignal;
    }>();
  });

  it('Provider exposes only streamOps, an async stream of TreeOps', () => {
    expectTypeOf<keyof Provider>().toEqualTypeOf<'streamOps'>();
    expectTypeOf<Provider['streamOps']>().toEqualTypeOf<
      (request: GenerateRequest) => AsyncIterable<TreeOp>
    >();
  });
});
