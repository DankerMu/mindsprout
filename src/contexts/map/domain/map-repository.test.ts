import { describe, expectTypeOf, it } from 'vitest';
import type { MapRepository, MapSummary } from './map-repository';
import type { MindMap } from './types';

// map-repository.ts is type-only; these assertions are checked by `pnpm typecheck` (tsc), not at runtime.
describe('map repository port', () => {
  it('MapSummary is exactly id, title and updatedAt as strings', () => {
    expectTypeOf<MapSummary>().toEqualTypeOf<{ id: string; title: string; updatedAt: string }>();
  });

  it('MapRepository exposes list/get/put/delete keyed by the MindMap id', () => {
    expectTypeOf<keyof MapRepository>().toEqualTypeOf<'list' | 'get' | 'put' | 'delete'>();
    expectTypeOf<MapRepository['list']>().toEqualTypeOf<() => Promise<MapSummary[]>>();
    expectTypeOf<MapRepository['get']>().toEqualTypeOf<
      (id: MindMap['id']) => Promise<MindMap | undefined>
    >();
    expectTypeOf<MapRepository['put']>().toEqualTypeOf<(map: MindMap) => Promise<void>>();
    expectTypeOf<MapRepository['delete']>().toEqualTypeOf<(id: MindMap['id']) => Promise<void>>();
  });
});
