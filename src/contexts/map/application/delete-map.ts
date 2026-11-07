import type { MapRepository } from '../domain/map-repository';

export function deleteMap(repository: MapRepository, id: string): Promise<void> {
  return repository.delete(id);
}
