import { afterEach, describe, expect, it, vi } from 'vitest';
import { deepFreeze, sampleMap } from '../../../../tests/support/map-domain';
import {
  ControlledLibrary,
  heldResult,
  memoryLibrary,
} from '../../../../tests/support/map-library';
import { RecordingRepository } from '../../../../tests/support/map-repository-stub';
import { UnsupportedSchemaVersionError } from '../domain/errors';
import type { MindMap } from '../domain/types';
import { renameMap, renameMetadata } from './rename-map';

const NOW = '2026-11-07T12:34:56.789Z';
const now = () => new Date(NOW);

class ReadRepository extends RecordingRepository {
  readonly reads: string[] = [];

  constructor(readonly result: Promise<MindMap | undefined>) {
    super();
  }

  override get(id = '') {
    this.reads.push(id);
    return this.result;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('renameMetadata', () => {
  it.each(['读书笔记', '', '  原样保留  '])('preserves the tree and literal title %j', (title) => {
    const original = sampleMap();
    const before = structuredClone(original);
    deepFreeze(original);
    const renamed = renameMetadata(original, title, NOW);
    expect(renamed).toStrictEqual({
      id: 'm1',
      title,
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: NOW,
      roots: before.roots,
    });
    expect(original).toStrictEqual(before);
    expect(renamed.roots).toBe(original.roots);
  });
});

describe('renameMap', () => {
  it('persists only target metadata and returns the complete saved map', async () => {
    const repository = memoryLibrary();
    const original = sampleMap();
    const peer = { ...sampleMap(), id: 'peer', title: '另一张导图' };
    await repository.put(original);
    await repository.put(peer);
    const renamed = await renameMap(repository, 'm1', '读书笔记', { now });
    const expected = {
      id: 'm1',
      title: '读书笔记',
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: NOW,
      roots: original.roots,
    };
    expect(renamed).toStrictEqual(expected);
    expect(await repository.get('m1')).toStrictEqual(expected);
    expect(await repository.get('peer')).toStrictEqual(peer);
    expect(original.title).toBe('导图');
  });

  it('uses the current time when no clock is supplied', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    const repository = memoryLibrary();
    await repository.put(sampleMap());
    await renameMap(repository, 'm1', '新标题');
    expect(await repository.get('m1')).toStrictEqual({
      ...sampleMap(),
      title: '新标题',
      updatedAt: NOW,
    });
  });

  it.each(['missing', 'mismatched embedded ID'])(
    'refuses a target with %s without changing its peer',
    async (kind) => {
      const repository = new ControlledLibrary();
      const peer = sampleMap();
      await repository.storage.put(peer);
      repository.read = () => Promise.resolve(kind === 'missing' ? undefined : peer);
      await expect(renameMap(repository, 'selected', '新标题', { now })).rejects.toBeInstanceOf(
        Error,
      );
      expect(repository.gets).toEqual(['selected']);
      expect(repository.puts).toEqual([]);
      expect(await repository.storage.get('selected')).toBeUndefined();
      expect(await repository.storage.get('m1')).toStrictEqual(peer);
    },
  );

  it.each([new UnsupportedSchemaVersionError(2, 1), new Error('read failed')])(
    'propagates a rejected read without writing: %s',
    async (error) => {
      const repository = new ReadRepository(Promise.reject(error));
      await expect(renameMap(repository, 'm1', '新标题', { now })).rejects.toBe(error);
      expect(repository.reads).toEqual(['m1']);
      expect(repository.puts).toEqual([]);
    },
  );

  it('does not write when the initiating lifetime ends during get', async () => {
    const pending = heldResult<MindMap | undefined>();
    const repository = new ReadRepository(pending.promise);
    let active = true;
    const result = renameMap(repository, 'm1', '新标题', { now, isActive: () => active });
    active = false;
    pending.resolve(sampleMap());
    expect(await result).toBeUndefined();
    expect(repository.puts).toEqual([]);
  });

  it('does not report success until put settles and propagates its failure', async () => {
    const repository = new ReadRepository(Promise.resolve(sampleMap()));
    const pending = repository.holdNext();
    let active = true;
    const result = renameMap(repository, 'm1', '新标题', { now, isActive: () => active });
    const settled = vi.fn();
    const observed = result.then(settled, settled);
    await Promise.resolve();
    expect(repository.puts).toStrictEqual([{ ...sampleMap(), title: '新标题', updatedAt: NOW }]);
    expect(settled).not.toHaveBeenCalled();
    active = false;
    const error = new Error('write failed');
    pending.reject(error);
    await expect(result).rejects.toBe(error);
    await observed;
    expect(settled).toHaveBeenCalledWith(error);
  });
});
