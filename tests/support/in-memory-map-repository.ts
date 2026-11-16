import type { MapRepository, MapSummary } from '../../src/contexts/map/domain/map-repository';
import type { MindMap } from '../../src/contexts/map/domain/types';
import { byRecency } from '../../src/contexts/map/domain/summary-order';

// Test double: clones on put and get so callers cannot alias its state.

export class InMemoryMapRepository implements MapRepository {
  readonly #maps = new Map<MindMap['id'], MindMap>();

  list(): Promise<MapSummary[]> {
    const summaries = [...this.#maps.values()].map(({ id, title, updatedAt }) => ({
      id,
      title,
      updatedAt,
    }));
    return Promise.resolve(summaries.sort(byRecency));
  }

  get(id: MindMap['id']): Promise<MindMap | undefined> {
    const map = this.#maps.get(id);
    return Promise.resolve(map === undefined ? undefined : structuredClone(map));
  }

  put(map: MindMap): Promise<void> {
    this.#maps.set(map.id, structuredClone(map));
    return Promise.resolve();
  }

  delete(id: MindMap['id']): Promise<void> {
    this.#maps.delete(id);
    return Promise.resolve();
  }
}
