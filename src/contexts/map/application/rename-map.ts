import type { MapRepository } from '../domain/map-repository';
import type { MindMap } from '../domain/types';

export function renameMetadata(map: MindMap, title: string, updatedAt: string): MindMap {
  return { ...map, title, updatedAt };
}

export async function renameMap(
  repository: MapRepository,
  id: string,
  title: string,
  options: { now?: () => Date; isActive?: () => boolean } = {},
): Promise<MindMap | undefined> {
  const map = await repository.get(id);
  if (map === undefined) throw new Error(`map "${id}" no longer exists`);
  if (map.id !== id) throw new Error(`stored map ID does not match "${id}"`);
  if (options.isActive?.() === false) return undefined;
  const renamed = renameMetadata(map, title, (options.now?.() ?? new Date()).toISOString());
  await repository.put(renamed);
  return renamed;
}
