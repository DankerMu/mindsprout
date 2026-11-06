import type { MapRepository, MapSummary } from '../../domain/map-repository';
import type { MindMap } from '../../domain/types';
import { byRecency } from './summary-order';

// Session fallback store (design D7): holds structuredClone copies, cloned in on put and out on
// get, so it behaves like IndexedDB's structured clone and callers can never alias its state.

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
