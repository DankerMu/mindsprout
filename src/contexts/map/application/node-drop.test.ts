import { describe, expect, it } from 'vitest';
import { deepFreeze, mapOf, node } from '../../../../tests/support/map-domain';
import { layoutForest, type ForestLayout } from './layout/layout-forest';
import { dropRefusal, hitDropTarget, planNodeDrop } from './node-drop';

const map = mapOf(
  node('r', [node('a', [node('d')]), node('p')]),
  node('f', [], { position: { x: 500, y: 200 } }),
);
deepFreeze(map);
const layout = layoutForest(map, { direction: 'LR' });
const at = (id: string) => {
  const point = layout.positions.get(id);
  if (point === undefined) throw new Error(id);
  return { x: point.x + 5, y: point.y + 5 };
};

describe('node drop', () => {
  it('uses half-open rectangles, layout order for overlap, and excludes the source', () => {
    const boxes: ForestLayout = {
      positions: new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 10, y: 0 }],
        ['missing', { x: 50, y: 0 }],
      ]),
      sizes: new Map([
        ['a', { width: 20, height: 20 }],
        ['b', { width: 20, height: 20 }],
      ]),
      edges: [],
    };
    for (const [point, expected] of [
      [{ x: 0, y: 0 }, 'a'],
      [{ x: 15, y: 10 }, 'a'],
      [{ x: 20, y: 0 }, 'b'],
      [{ x: 30, y: 0 }, undefined],
      [{ x: 0, y: 20 }, undefined],
      [{ x: -1, y: 0 }, undefined],
      [{ x: 50, y: 0 }, undefined],
    ] as const)
      expect(hitDropTarget(boxes, point)).toBe(expected);
    expect(hitDropTarget(boxes, { x: 15, y: 10 }, 'a')).toBe('b');
  });

  it('removes a formerly hittable descendant when its ancestor collapses', () => {
    const expanded = layoutForest(mapOf(node('r', [node('h')])), { direction: 'LR' });
    const child = expanded.positions.get('h');
    if (child === undefined) throw new Error('expanded child has no position');
    const point = { x: child.x + 1, y: child.y + 1 };
    expect(hitDropTarget(expanded, point)).toBe('h');
    const hidden = layoutForest(mapOf(node('r', [node('h')], { collapsed: true })), {
      direction: 'LR',
    });
    expect(hitDropTarget(hidden, point)).toBeUndefined();
  });

  it('treats a column gap as empty', () => {
    expect(hitDropTarget(layout, { x: 90, y: 0 })).toBeUndefined();
  });

  it.each([
    ['r', 'f', 'primary-root'],
    ['a', 'a', 'self'],
    ['a', 'd', 'cycle'],
    ['a', 'p', undefined],
    ['f', undefined, undefined],
  ] as const)('refuses %s onto %s with %s', (id, target, reason) => {
    expect(dropRefusal(map, id, target)).toBe(reason);
  });

  it.each([
    ['a', 'p', { op: 'move_node', id: 'a', newParentId: 'p' }],
    ['a', undefined, { op: 'move_node', id: 'a', newParentId: null, position: { x: 400, y: 300 } }],
    ['f', undefined, { op: 'set_root_position', id: 'f', position: { x: 400, y: 300 } }],
    ['f', 'p', { op: 'move_node', id: 'f', newParentId: 'p' }],
  ] as const)('plans %s onto %s without mutating inputs', (id, target, op) => {
    const before = structuredClone({ map, layout });
    expect(
      planNodeDrop(map, layout, [id], id, target === undefined ? { x: 420, y: 310 } : at(target), {
        x: 400,
        y: 300,
      }),
    ).toStrictEqual({ ops: [op] });
    expect({ map, layout }).toStrictEqual(before);
  });

  it.each([
    ['r', 'f', 'primary-root'],
    ['a', 'a', 'self'],
    ['a', 'd', 'cycle'],
  ] as const)('plans no operation for %s onto %s', (id, target, refusal) => {
    expect(planNodeDrop(map, layout, [id], id, at(target), { x: 400, y: 300 })).toStrictEqual({
      refusal,
    });
  });

  it('detaches the frozen visual group at exact 80px offsets without changing inputs', () => {
    const forest = mapOf(node('r', [node('a'), node('b')]));
    const boxes = layoutForest(forest, { direction: 'LR' });
    boxes.positions.set('a', { x: 100, y: 20 });
    boxes.positions.set('b', { x: 100, y: 100 });
    const selection = ['b', 'a'];
    const before = structuredClone({ forest, boxes, selection });
    expect(
      planNodeDrop(forest, boxes, selection, 'a', { x: 420, y: 310 }, { x: 400, y: 300 }),
    ).toStrictEqual({
      ops: [
        { op: 'move_node', id: 'a', newParentId: null, position: { x: 400, y: 300 } },
        { op: 'move_node', id: 'b', newParentId: null, position: { x: 400, y: 380 } },
      ],
    });
    expect({ forest, boxes, selection }).toStrictEqual(before);
  });

  it.each([
    [{ x: 100, y: 80 }, { x: 100, y: 0 }, ['b', 'a']],
    [{ x: 120, y: 0 }, { x: 100, y: 0 }, ['b', 'a']],
    [{ x: 100, y: 0 }, { x: 100, y: 0 }, ['a', 'b']],
  ] as const)(
    'appends in visual order with traversal ties, independent of click order',
    (a, b, order) => {
      const forest = mapOf(
        node('r', [
          node('left', [node('a', [node('d')]), node('s')]),
          node('right', [node('b', [node('e')])]),
          node('p', [node('q')]),
        ]),
      );
      const boxes = layoutForest(forest, { direction: 'LR' });
      boxes.positions.set('a', a);
      boxes.positions.set('b', b);
      const target = boxes.positions.get('p');
      if (target === undefined) throw new Error('missing target geometry');
      expect(
        planNodeDrop(forest, boxes, ['b', 'a'], 'a', target, { x: 400, y: 300 }),
      ).toStrictEqual({ ops: order.map((id) => ({ op: 'move_node', id, newParentId: 'p' })) });
    },
  );

  it.each(['a', 'd'])(
    'normalizes nested selection while retaining %s as delta anchor',
    (grabbed) => {
      const boxes = layoutForest(map, { direction: 'LR' });
      boxes.positions.set('a', { x: 100, y: 20 });
      boxes.positions.set('d', { x: 200, y: 40 });
      expect(
        planNodeDrop(map, boxes, ['d', 'a'], grabbed, { x: 420, y: 310 }, { x: 400, y: 300 }),
      ).toStrictEqual({
        ops: [
          {
            op: 'move_node',
            id: 'a',
            newParentId: null,
            position: grabbed === 'a' ? { x: 400, y: 300 } : { x: 300, y: 280 },
          },
        ],
      });
    },
  );

  it('combines tree detach and fractional floating reposition in visual order', () => {
    const boxes = layoutForest(map, { direction: 'LR' });
    boxes.positions.set('a', { x: 100, y: 20 });
    boxes.positions.set('f', { x: 180.25, y: 100.75 });
    expect(
      planNodeDrop(map, boxes, ['f', 'a'], 'a', { x: 420, y: 310 }, { x: 400, y: 300 }),
    ).toStrictEqual({
      ops: [
        { op: 'move_node', id: 'a', newParentId: null, position: { x: 400, y: 300 } },
        { op: 'set_root_position', id: 'f', position: { x: 480.25, y: 380.75 } },
      ],
    });
  });

  it('repositions multiple floating roots without detaching them again', () => {
    const forest = mapOf(
      node('r'),
      node('f', [], { position: { x: 100, y: 20 } }),
      node('g', [], { position: { x: 100, y: 100 } }),
    );
    expect(
      planNodeDrop(
        forest,
        layoutForest(forest, { direction: 'LR' }),
        ['g', 'f'],
        'f',
        { x: 420, y: 310 },
        { x: 400, y: 300 },
      ),
    ).toStrictEqual({
      ops: [
        { op: 'set_root_position', id: 'f', position: { x: 400, y: 300 } },
        { op: 'set_root_position', id: 'g', position: { x: 400, y: 380 } },
      ],
    });
  });

  it.each([
    [['a', 'r'], 'f', 'primary-root'],
    [['a', 'f'], 'f', 'self'],
    [['a', 'f'], 'd', 'cycle'],
  ] as const)('refuses the whole selection %s on %s', (selection, target, refusal) => {
    expect(planNodeDrop(map, layout, selection, 'a', at(target), { x: 400, y: 300 })).toStrictEqual(
      { refusal },
    );
  });

  it.each(['unknown', 'position', 'size', 'descendant', 'hidden'] as const)(
    'refuses incomplete %s geometry instead of emitting a partial plan',
    (missing) => {
      const forest = structuredClone(map);
      const boxes = layoutForest(forest, { direction: 'LR' });
      const selection = ['a', 'f'];
      if (missing === 'unknown') selection.push('missing');
      if (missing === 'position') boxes.positions.delete('f');
      if (missing === 'size') boxes.sizes.delete('f');
      if (missing === 'descendant') boxes.positions.delete('d');
      if (missing === 'hidden') {
        const primary = forest.roots[0];
        if (primary === undefined) throw new Error('missing primary root');
        primary.collapsed = true;
      }
      expect(
        planNodeDrop(forest, boxes, selection, 'a', { x: 420, y: 310 }, { x: 400, y: 300 }),
      ).toStrictEqual({ refusal: 'stale' });
    },
  );

  it('selects only an unselected grab and rejects an unknown grabbed identity', () => {
    expect(planNodeDrop(map, layout, ['f'], 'a', at('p'), { x: 400, y: 300 })).toStrictEqual({
      ops: [{ op: 'move_node', id: 'a', newParentId: 'p' }],
    });
    expect(planNodeDrop(map, layout, ['f'], 'missing', at('p'), { x: 400, y: 300 })).toStrictEqual({
      refusal: 'stale',
    });
  });
});
