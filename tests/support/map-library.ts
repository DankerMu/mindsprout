import type { MapRepository } from '../../src/contexts/map/domain/map-repository';
import type { MindMap } from '../../src/contexts/map/domain/types';
import { InMemoryMapRepository } from '../../src/contexts/map/infrastructure/persistence/in-memory-map-repository';

// Component tests consume the repository port; adapter construction stays outside src/components.
export function memoryLibrary(): MapRepository {
  return new InMemoryMapRepository();
}

export class ControlledLibrary implements MapRepository {
  readonly storage = memoryLibrary();
  readonly gets: string[] = [];
  readonly puts: MindMap[] = [];
  readonly deletes: string[] = [];
  lists = 0;
  read: ((id: string) => Promise<MindMap | undefined>) | undefined;
  beforePut: Promise<void> | undefined;
  beforeDelete: Promise<void> | undefined;

  list() {
    this.lists += 1;
    return this.storage.list();
  }

  get(id: string) {
    this.gets.push(id);
    return this.read === undefined ? this.storage.get(id) : this.read(id);
  }

  async put(map: MindMap) {
    this.puts.push(map);
    await this.beforePut;
    await this.storage.put(map);
  }

  async delete(id: string) {
    this.deletes.push(id);
    await this.beforeDelete;
    await this.storage.delete(id);
  }
}

export function heldResult<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('promise not initialized');
  };
  let reject: (error: Error) => void = () => {
    throw new Error('promise not initialized');
  };
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
