import { describe, expect, it, vi } from 'vitest';
import { sampleMap } from '../../../../tests/support/map-domain';
import { ControlledLibrary, heldResult } from '../../../../tests/support/map-library';
import { UnsupportedSchemaVersionError } from '../domain/errors';
import { deleteMap } from './delete-map';

describe('deleteMap', () => {
  it('removes only the captured key even when reading its contents would reject', async () => {
    const repository = new ControlledLibrary();
    const target = { ...sampleMap(), id: 'selected /?#' };
    const peer = sampleMap();
    await repository.storage.put(target);
    await repository.storage.put(peer);
    repository.read = () => Promise.reject(new UnsupportedSchemaVersionError(2, 1));

    await deleteMap(repository, target.id);

    expect(repository.deletes).toEqual(['selected /?#']);
    expect(repository.gets).toEqual([]);
    expect(repository.puts).toEqual([]);
    expect(repository.lists).toBe(0);
    expect(await repository.storage.get(target.id)).toBeUndefined();
    expect(await repository.storage.get(peer.id)).toStrictEqual(peer);
  });

  it.each(['resolve', 'reject'] as const)(
    'waits for deletion and preserves durable state on failure: %s',
    async (outcome) => {
      const repository = new ControlledLibrary();
      const target = sampleMap();
      const peer = { ...sampleMap(), id: 'peer', title: '另一张导图' };
      await repository.storage.put(target);
      await repository.storage.put(peer);
      const pending = heldResult<Awaited<Promise<void>>>();
      repository.beforeDelete = pending.promise;
      const result = deleteMap(repository, target.id);
      const settled = vi.fn();
      const observed = result.then(settled, settled);
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(await repository.storage.get(target.id)).toStrictEqual(target);
      const error = new Error('delete failed');
      if (outcome === 'resolve') pending.resolve();
      else pending.reject(error);
      await observed;
      if (outcome === 'resolve') {
        expect(await repository.storage.get(target.id)).toBeUndefined();
        expect(settled).toHaveBeenCalledWith(undefined);
      } else {
        await expect(result).rejects.toBe(error);
        expect(await repository.storage.get(target.id)).toStrictEqual(target);
      }
      expect(await repository.storage.get(peer.id)).toStrictEqual(peer);
      expect(repository.deletes).toEqual(['m1']);
      expect(repository.gets).toEqual([]);
      expect(repository.puts).toEqual([]);
    },
  );
});
