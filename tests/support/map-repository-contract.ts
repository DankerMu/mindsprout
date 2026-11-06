import { describe, expect, it } from 'vitest';
import type { MapRepository } from '../../src/contexts/map/domain/map-repository';
import type { MindMap } from '../../src/contexts/map/domain/types';
import { deepFreeze, mapOf, node } from './map-domain';

// Shared MapRepository contract (design "Fixture — issue #10"). Every adapter runs it unchanged:
// each case asks the factory for a fresh, empty repository, uses only the port, and compares by
// deep equality only (never identity), so a structured-cloning store passes.

const AT_10 = '2026-11-05T10:00:00.000Z';
const AT_11 = '2026-11-05T11:00:00.000Z';
const AT_12 = '2026-11-05T12:00:00.000Z';

function storedMap(id: string, updatedAt: string, title = `导图 ${id}`): MindMap {
  return { ...mapOf(node(`${id}-root`, [node(`${id}-child`)])), id, title, updatedAt };
}

// Floating root with a position, a collapsed child with note and color, nested children, and
// deliberately old metadata, so stamping or dropping any attribute shows up as a diff.
function richMap(): MindMap {
  return {
    id: 'rich',
    title: '读书笔记',
    roots: [
      node('r', [node('p', [node('a', [node('a1')]), node('b')])]),
      node(
        'f1',
        [node('fc', [node('fc1')], { collapsed: true, note: '第一行\n第二行', color: 'purple' })],
        { position: { x: 300, y: 200 } },
      ),
    ],
    createdAt: '2001-01-01T00:00:00.000Z',
    updatedAt: '2001-02-03T04:05:06.000Z',
  };
}

async function idsOfList(repository: MapRepository): Promise<string[]> {
  return (await repository.list()).map((summary) => summary.id);
}

export function describeMapRepositoryContract(
  label: string,
  createRepository: () => MapRepository | Promise<MapRepository>,
): void {
  describe(`${label} satisfies the MapRepository contract`, () => {
    it('starts empty: list is [] and get of any id is undefined', async () => {
      const repository = await createRepository();

      expect(await repository.list()).toStrictEqual([]);
      expect(await repository.get('m1')).toBeUndefined();
    });

    it('orders by updatedAt, not by put order, also after a replacement', async () => {
      const repository = await createRepository();
      await repository.put(storedMap('a', AT_11));
      await repository.put(storedMap('b', AT_10));
      await repository.put(storedMap('b', AT_12));
      // Put order a, b, c, b: insertion order, its reverse, and move-to-end-on-replace (either
      // direction) all differ from the updatedAt order c, a, b.
      const mixed = await createRepository();
      await mixed.put(storedMap('a', AT_11));
      await mixed.put(storedMap('b', AT_10));
      await mixed.put(storedMap('c', AT_12));
      await mixed.put(storedMap('b', '2026-11-05T10:30:00.000Z'));

      expect(await repository.list()).toStrictEqual([
        { id: 'b', title: '导图 b', updatedAt: AT_12 },
        { id: 'a', title: '导图 a', updatedAt: AT_11 },
      ]);
      expect(await idsOfList(mixed)).toStrictEqual(['c', 'a', 'b']);
    });

    it('lists by updatedAt descending, ties broken by id ascending', async () => {
      const repository = await createRepository();
      await repository.put(storedMap('a', AT_10));
      await repository.put(storedMap('c', AT_11));
      await repository.put(storedMap('b', AT_11));

      expect(await idsOfList(repository)).toStrictEqual(['b', 'c', 'a']);
    });

    it('breaks updatedAt ties by plain code-unit order, whatever the put order', async () => {
      const aFirst = await createRepository();
      await aFirst.put(storedMap('a', AT_10));
      await aFirst.put(storedMap('B', AT_10));
      const bFirst = await createRepository();
      await bFirst.put(storedMap('B', AT_10));
      await bFirst.put(storedMap('a', AT_10));

      expect(await idsOfList(aFirst)).toStrictEqual(['B', 'a']);
      expect(await idsOfList(bFirst)).toStrictEqual(['B', 'a']);
    });

    it('lists exactly { id, title, updatedAt } of each stored map', async () => {
      const repository = await createRepository();
      await repository.put(richMap());

      const summaries = await repository.list();

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toStrictEqual({
        id: 'rich',
        title: '读书笔记',
        updatedAt: '2001-02-03T04:05:06.000Z',
      });
      expect(Object.keys(summaries[0] ?? {}).sort()).toStrictEqual(['id', 'title', 'updatedAt']);
    });

    it('resolves undefined for an unknown id while other maps are stored', async () => {
      const repository = await createRepository();
      await repository.put(storedMap('a', AT_10));

      expect(await repository.get('missing')).toBeUndefined();
    });

    it('stores the map exactly as given, without stamping updatedAt', async () => {
      const repository = await createRepository();
      await repository.put(richMap());

      expect(await repository.get('rich')).toStrictEqual(richMap());
    });

    it('replaces the map stored under an existing id', async () => {
      const repository = await createRepository();
      await repository.put(storedMap('a', AT_10, '初稿'));
      const second = { ...storedMap('a', AT_11, '定稿'), roots: [node('other-root')] };
      await repository.put(second);

      expect(await repository.get('a')).toStrictEqual(second);
      expect(await repository.list()).toStrictEqual([{ id: 'a', title: '定稿', updatedAt: AT_11 }]);
    });

    it('deletes a map and leaves the others untouched', async () => {
      const repository = await createRepository();
      await repository.put(storedMap('a', AT_10));
      await repository.put(storedMap('b', AT_11));

      await repository.delete('a');

      expect(await repository.get('a')).toBeUndefined();
      expect(await idsOfList(repository)).toStrictEqual(['b']);
      expect(await repository.get('b')).toStrictEqual(storedMap('b', AT_11));
    });

    it('resolves a delete of an unknown id and changes nothing', async () => {
      const repository = await createRepository();
      await repository.put(storedMap('a', AT_10));

      await expect(repository.delete('missing')).resolves.toBeUndefined();

      expect(await repository.list()).toStrictEqual([
        { id: 'a', title: '导图 a', updatedAt: AT_10 },
      ]);
      expect(await repository.get('a')).toStrictEqual(storedMap('a', AT_10));
    });

    it('is not changed by mutating the object passed to put', async () => {
      const repository = await createRepository();
      const input = richMap();
      await repository.put(input);

      input.title = '改了';
      input.updatedAt = AT_11;
      input.roots[0]?.children.push(node('intruder'));
      input.roots.pop();

      expect(await repository.get('rich')).toStrictEqual(richMap());
      expect(await repository.list()).toStrictEqual([
        { id: 'rich', title: '读书笔记', updatedAt: '2001-02-03T04:05:06.000Z' },
      ]);
    });

    it('is not changed by mutating the objects returned by get or list', async () => {
      const repository = await createRepository();
      await repository.put(richMap());

      const got = await repository.get('rich');
      if (got === undefined) throw new Error('expected the stored map');
      got.title = '改了';
      got.updatedAt = AT_11;
      got.roots[0]?.children.push(node('intruder'));
      got.roots.pop();
      const [summary] = await repository.list();
      if (summary === undefined) throw new Error('expected one summary');
      summary.title = '也改了';

      expect(await repository.get('rich')).toStrictEqual(richMap());
      expect(await repository.list()).toStrictEqual([
        { id: 'rich', title: '读书笔记', updatedAt: '2001-02-03T04:05:06.000Z' },
      ]);
    });

    it('accepts a deep-frozen map and never mutates its input', async () => {
      const repository = await createRepository();
      const input = richMap();
      deepFreeze(input);

      await repository.put(input);

      expect(input).toStrictEqual(richMap());
      expect(await repository.get('rich')).toStrictEqual(richMap());
    });
  });
}
