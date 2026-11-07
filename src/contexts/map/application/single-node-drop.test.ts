import { describe, expect, it } from 'vitest';
import { deepFreeze, mapOf, node } from '../../../../tests/support/map-domain';
import { layoutForest, type ForestLayout } from './layout/layout-forest';
import { dropRefusal, hitDropTarget, planSingleNodeDrop } from './single-node-drop';

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

describe('single-node drop', () => {
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
      planSingleNodeDrop(map, layout, id, target === undefined ? { x: 420, y: 310 } : at(target), {
        x: 400,
        y: 300,
      }),
    ).toStrictEqual({ op });
    expect({ map, layout }).toStrictEqual(before);
  });

  it.each([
    ['r', 'f', 'primary-root'],
    ['a', 'a', 'self'],
    ['a', 'd', 'cycle'],
  ] as const)('plans no operation for %s onto %s', (id, target, refusal) => {
    expect(planSingleNodeDrop(map, layout, id, at(target), { x: 400, y: 300 })).toStrictEqual({
      refusal,
    });
  });
});
