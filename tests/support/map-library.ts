import type { MapRepository } from '../../src/contexts/map/domain/map-repository';
import { InMemoryMapRepository } from '../../src/contexts/map/infrastructure/persistence/in-memory-map-repository';

// Component tests consume the repository port; adapter construction stays outside src/components.
export function memoryLibrary(): MapRepository {
  return new InMemoryMapRepository();
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
