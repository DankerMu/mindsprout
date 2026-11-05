import { describe, expect, it } from 'vitest';
import {
  apply,
  applyAndUndo,
  entriesOf,
  expectRejected,
  idsOf,
  mapOf,
  node,
  nodeIn,
  undo,
} from '../../../../tests/support/map-domain';
import type { TreeOp } from './tree-op';
import type { MindMap, NewNode, NodeId } from './types';

// Seam under test: applyOp (design "Fixture — issue #5"): move_node (reparent, attach, detach),
// set_root_position and replace_children. Expected inverses are literals from the spec and the
// fixture, never recomputed. Frozen-input, metadata and D1 checks run inside the shared helpers.

// r ─ p ─ (a ─ a1, b, c)
//   └ q ─ (q1, q2)
// f1 @ (10, 20) ─ fc ─ fcc
// f2 @ (30, 40)
function forest(): MindMap {
  return mapOf(
    node('r', [
      node('p', [node('a', [node('a1')]), node('b'), node('c')]),
      node('q', [node('q1'), node('q2')]),
    ]),
    node('f1', [node('fc', [node('fcc')])], { position: { x: 10, y: 20 } }),
    node('f2', [], { position: { x: 30, y: 40 } }),
  );
}

function moving(id: NodeId, newParentId: NodeId, index?: number): TreeOp {
  return { op: 'move_node', id, newParentId, ...(index === undefined ? {} : { index }) };
}

function detaching(id: NodeId, index?: number, position = { x: 300, y: 200 }): TreeOp {
  return {
    op: 'move_node',
    id,
    newParentId: null,
    position,
    ...(index === undefined ? {} : { index }),
  };
}

function positionOf(op: TreeOp | undefined): unknown {
  return op !== undefined && 'position' in op ? op.position : undefined;
}

function replacing(parentId: NodeId, children: NewNode[]): TreeOp {
  return { op: 'replace_children', parentId, children };
}

describe('applyOp — move_node reparent', () => {
  it('reparents across parents at an explicit middle index', () => {
    const { map: next, inverse } = applyAndUndo(forest(), moving('a', 'q', 1));

    expect(idsOf(nodeIn(next, 'q').children)).toStrictEqual(['q1', 'a', 'q2']);
    expect(idsOf(nodeIn(next, 'p').children)).toStrictEqual(['b', 'c']);
    expect(nodeIn(next, 'a')).toStrictEqual(node('a', [node('a1')]));
    expect(inverse).toStrictEqual([{ op: 'move_node', id: 'a', newParentId: 'p', index: 0 }]);
  });

  it('appends under the new parent when no index is given', () => {
    const { map: next, inverse } = applyAndUndo(forest(), moving('c', 'fc'));

    expect(idsOf(nodeIn(next, 'fc').children)).toStrictEqual(['fcc', 'c']);
    expect(inverse).toStrictEqual([{ op: 'move_node', id: 'c', newParentId: 'p', index: 2 }]);
  });

  it.each([
    ['first child to index 2 becomes last', 'a', 2, ['b', 'c', 'a'], 0],
    ['last child to index 0 becomes first', 'c', 0, ['c', 'a', 'b'], 2],
    ['first child to index 1 lands in the middle', 'a', 1, ['b', 'a', 'c'], 0],
    ['a child to its own index stays put', 'b', 1, ['a', 'b', 'c'], 1],
  ] as const)('reorders within the same parent: %s', (_label, id, index, expected, oldIndex) => {
    const { map: next, inverse } = applyAndUndo(forest(), moving(id, 'p', index));

    expect(idsOf(nodeIn(next, 'p').children)).toStrictEqual(expected);
    expect(inverse).toStrictEqual([{ op: 'move_node', id, newParentId: 'p', index: oldIndex }]);
  });

  it('appends within the same parent when no index is given', () => {
    const { map: next } = applyAndUndo(forest(), moving('a', 'p'));

    expect(idsOf(nodeIn(next, 'p').children)).toStrictEqual(['b', 'c', 'a']);
  });

  it.each([
    ['same parent: index == children.length (counted without the node)', moving('a', 'p', 3)],
    ['other parent: index > children.length', moving('a', 'q', 3)],
  ])('rejects an out-of-range index with invalid-target (%s)', (_label, op) => {
    expectRejected(forest(), op, 'invalid-target');
  });

  it('accepts index == children.length of another parent (append)', () => {
    const { map: next } = applyAndUndo(forest(), moving('a', 'q', 2));

    expect(idsOf(nodeIn(next, 'q').children)).toStrictEqual(['q1', 'q2', 'a']);
  });

  it.each([
    ['under its own child', moving('a', 'a1')],
    ['under itself', moving('a', 'a')],
    ['under a deeper descendant', moving('p', 'a1')],
  ])('Move a node under its own child (%s) is rejected with cycle', (_label, op) => {
    expectRejected(forest(), op, 'cycle');
  });

  it.each([
    ['reparent', moving('r', 'f1')],
    ['reparent under its own descendant (primary check first)', moving('r', 'p')],
    ['detach', detaching('r')],
  ])('rejects moving the primary root (%s) with primary-root-protected', (_label, op) => {
    expectRejected(forest(), op, 'primary-root-protected');
  });

  it.each([
    ['unknown id', moving('missing', 'p')],
    ['unknown newParentId', moving('a', 'missing')],
    ['unknown newParentId checked before the primary-root rule', moving('r', 'missing')],
    ['unknown id on detach', detaching('missing')],
  ])('rejects %s with unknown-node', (_label, op) => {
    expectRejected(forest(), op, 'unknown-node');
  });
});

describe('applyOp — move_node attach', () => {
  it('Attach a floating root under a node', () => {
    const map = mapOf(
      node('r', [node('p', [node('x')])]),
      node('f1', [], { position: { x: 1, y: 1 } }),
      node('f', [node('fa')], { position: { x: 300, y: 200 } }),
      node('f3', [], { position: { x: 3, y: 3 } }),
    );

    const { map: next, inverse } = applyAndUndo(map, moving('f', 'p'));

    expect(idsOf(next.roots)).toStrictEqual(['r', 'f1', 'f3']);
    expect(nodeIn(next, 'p').children).toStrictEqual([node('x'), node('f', [node('fa')])]);
    expect(nodeIn(next, 'f')).not.toHaveProperty('position');
    expect(inverse).toStrictEqual([
      { op: 'move_node', id: 'f', newParentId: null, position: { x: 300, y: 200 }, index: 2 },
    ]);
  });

  it('attaches at an explicit index under a floating root', () => {
    const { map: next, inverse } = applyAndUndo(forest(), moving('f2', 'f1', 0));

    expect(idsOf(next.roots)).toStrictEqual(['r', 'f1']);
    expect(nodeIn(next, 'f1').children).toStrictEqual([node('f2'), node('fc', [node('fcc')])]);
    expect(inverse).toStrictEqual([
      { op: 'move_node', id: 'f2', newParentId: null, position: { x: 30, y: 40 }, index: 2 },
    ]);
  });

  it('copies the old position into the inverse instead of aliasing the input map', () => {
    const map = forest();

    const { inverse } = apply(map, moving('f1', 'q'));

    expect(positionOf(inverse[0])).toStrictEqual({ x: 10, y: 20 });
    expect(positionOf(inverse[0])).not.toBe(map.roots[1]?.position);
  });

  it.each([
    ['under its own child', moving('f1', 'fc')],
    ['under a deeper descendant', moving('f1', 'fcc')],
    ['under itself', moving('f1', 'f1')],
  ])('rejects attaching a floating root %s with cycle', (_label, op) => {
    expectRejected(forest(), op, 'cycle');
  });

  it('rejects an attach index > children.length with invalid-target', () => {
    expectRejected(forest(), moving('f2', 'q', 3), 'invalid-target');
  });

  it('rejects attaching a floating root without a position (corrupt map) with invalid-target', () => {
    expectRejected(mapOf(node('r'), node('f')), moving('f', 'r'), 'invalid-target');
  });
});

describe('applyOp — move_node detach', () => {
  it('Detach a child into a floating root', () => {
    const map = forest();

    const { map: next, inverse } = applyAndUndo(map, detaching('a'));

    expect(idsOf(next.roots)).toStrictEqual(['r', 'f1', 'f2', 'a']);
    expect(next.roots[3]).toStrictEqual(node('a', [node('a1')], { position: { x: 300, y: 200 } }));
    expect(idsOf(nodeIn(next, 'p').children)).toStrictEqual(['b', 'c']);
    expect(inverse).toStrictEqual([{ op: 'move_node', id: 'a', newParentId: 'p', index: 0 }]);
  });

  it('detaches a middle child to a middle roots index', () => {
    const { map: next, inverse } = applyAndUndo(forest(), detaching('b', 1, { x: -5, y: 7.5 }));

    expect(idsOf(next.roots)).toStrictEqual(['r', 'b', 'f1', 'f2']);
    expect(next.roots[1]).toStrictEqual(node('b', [], { position: { x: -5, y: 7.5 } }));
    expect(inverse).toStrictEqual([{ op: 'move_node', id: 'b', newParentId: 'p', index: 1 }]);
  });

  it('detaches a child of a floating root at index == roots.length (append)', () => {
    const { map: next, inverse } = applyAndUndo(forest(), detaching('fcc', 3));

    expect(idsOf(next.roots)).toStrictEqual(['r', 'f1', 'f2', 'fcc']);
    expect(inverse).toStrictEqual([{ op: 'move_node', id: 'fcc', newParentId: 'fc', index: 0 }]);
  });

  it.each([
    ['index 0 (the primary slot)', 0],
    ['index beyond roots.length', 4],
  ])('rejects detach at %s with invalid-target', (_label, index) => {
    expectRejected(forest(), detaching('a', index), 'invalid-target');
  });

  it('Detach a node that is already floating', () => {
    expectRejected(forest(), detaching('f1'), 'invalid-target');
  });

  it('does not alias the op position into the returned map', () => {
    const position = { x: 300, y: 200 };
    const op = detaching('a', undefined, position);

    const { map: next } = apply(forest(), op);
    position.x = 999;

    expect(nodeIn(next, 'a').position).toStrictEqual({ x: 300, y: 200 });
  });
});

describe('applyOp — set_root_position', () => {
  it('moves a floating root and inverts to its previous position', () => {
    const map = forest();

    const { map: next, inverse } = applyAndUndo(map, {
      op: 'set_root_position',
      id: 'f2',
      position: { x: -1, y: 2.5 },
    });

    expect(next.roots[2]).toStrictEqual(node('f2', [], { position: { x: -1, y: 2.5 } }));
    expect(next.roots.slice(0, 2)).toStrictEqual(map.roots.slice(0, 2));
    expect(inverse).toStrictEqual([
      { op: 'set_root_position', id: 'f2', position: { x: 30, y: 40 } },
    ]);
  });

  it('copies positions: neither the op nor the input map is aliased', () => {
    const map = forest();
    const position = { x: 5, y: 6 };

    const { map: next, inverse } = apply(map, { op: 'set_root_position', id: 'f1', position });
    position.y = 999;

    expect(next.roots[1]?.position).toStrictEqual({ x: 5, y: 6 });
    expect(inverse).toStrictEqual([
      { op: 'set_root_position', id: 'f1', position: { x: 10, y: 20 } },
    ]);
    expect(positionOf(inverse[0])).not.toBe(map.roots[1]?.position);
  });

  it('Positioning the primary root', () => {
    expectRejected(
      forest(),
      { op: 'set_root_position', id: 'r', position: { x: 1, y: 1 } },
      'primary-root-protected',
    );
  });

  it.each(['a', 'fc'])('Position a non-root node (%s)', (id) => {
    expectRejected(
      forest(),
      { op: 'set_root_position', id, position: { x: 1, y: 1 } },
      'invalid-target',
    );
  });

  it('rejects a floating root without a position (corrupt map) with invalid-target', () => {
    const corrupt = mapOf(node('r'), node('f'));

    expectRejected(
      corrupt,
      { op: 'set_root_position', id: 'f', position: { x: 1, y: 1 } },
      'invalid-target',
    );
  });

  it('rejects an unknown id with unknown-node', () => {
    expectRejected(
      forest(),
      { op: 'set_root_position', id: 'missing', position: { x: 1, y: 1 } },
      'unknown-node',
    );
  });
});

describe('applyOp — replace_children', () => {
  // P has children [a ─ a1, b ─ b1]; elsewhere: s (sibling of P) and floating f.
  const replaceable = (): MindMap =>
    mapOf(
      node('r', [
        node('p', [node('a', [node('a1')]), node('b', [node('b1')], { color: 'red' })]),
        node('s'),
      ]),
      node('f', [node('fx')], { position: { x: 7, y: 8 } }),
    );
  // The exact inverse of any replace_children on P: P's previous children as NewNodes.
  const RESTORE_P = [
    {
      op: 'replace_children',
      parentId: 'p',
      children: [
        { id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] },
        { id: 'b', text: 'B', color: 'red', children: [{ id: 'b1', text: 'B1', children: [] }] },
      ],
    },
  ];

  it('Reuse of replaced ids is accepted', () => {
    const { map: next, inverse } = applyAndUndo(
      replaceable(),
      replacing('p', [
        { id: 'a', text: 'new a' },
        { id: 'c', text: 'C' },
      ]),
    );

    expect(nodeIn(next, 'p').children).toStrictEqual([
      { id: 'a', text: 'new a', children: [] },
      node('c'),
    ]);
    const ids = idsOf(entriesOf(next).map((entry) => entry.node));
    expect(ids).toStrictEqual(['r', 'p', 'a', 'c', 's', 'f', 'fx']);
    expect(inverse).toStrictEqual(RESTORE_P);
  });

  it('accepts descendant ids re-nested at another depth', () => {
    const { map: next } = applyAndUndo(
      replaceable(),
      replacing('p', [
        {
          id: 'b1',
          text: 'B1',
          children: [{ id: 'a', text: 'A', children: [{ id: 'b', text: 'B' }] }],
        },
      ]),
    );

    expect(nodeIn(next, 'p').children).toStrictEqual([node('b1', [node('a', [node('b')])])]);
  });

  it.each([
    ['a node outside P’s subtree (sibling)', 's'],
    ['a node inside a floating root', 'fx'],
    ['an ancestor of P', 'r'],
    ['P itself', 'p'],
  ])('External duplicate is rejected: id of %s', (_label, id) => {
    expectRejected(replaceable(), replacing('p', [{ id, text: 'dup' }]), 'invalid-target');
  });

  it('rejects a duplicate inside the payload with invalid-target, even of a reusable id', () => {
    const payload = [{ id: 'a', text: '1', children: [{ id: 'a', text: '2' }] }];

    expectRejected(replaceable(), replacing('p', payload), 'invalid-target');
  });

  it('Inverse restores the old children', () => {
    const map = replaceable();

    const { map: next, inverse } = apply(map, replacing('p', [{ id: 'c', text: 'C' }]));
    const restored = undo(next, inverse);

    expect(nodeIn(next, 'p').children).toStrictEqual([node('c')]);
    expect(inverse).toStrictEqual(RESTORE_P);
    expect(nodeIn(restored, 'p').children).toStrictEqual([
      node('a', [node('a1')]),
      node('b', [node('b1')], { color: 'red' }),
    ]);
    expect(restored).toStrictEqual(map);
  });

  it('replaces with [] and inverts to the previous children; [] on a leaf inverts to []', () => {
    const { map: next, inverse } = applyAndUndo(replaceable(), replacing('p', []));

    expect(nodeIn(next, 'p').children).toStrictEqual([]);
    expect(inverse).toStrictEqual(RESTORE_P);
    const { inverse: leafInverse } = applyAndUndo(replaceable(), replacing('s', []));
    expect(leafInverse).toStrictEqual([{ op: 'replace_children', parentId: 's', children: [] }]);
  });

  it('stores a NewNode carrying collapsed: false without the flag and keeps collapsed: true', () => {
    const { map: next } = applyAndUndo(
      replaceable(),
      replacing('p', [
        {
          id: 'c',
          text: 'C',
          collapsed: false,
          children: [{ id: 'd', text: 'D', collapsed: true, note: 'n' }],
        },
      ]),
    );

    expect(nodeIn(next, 'p').children).toStrictEqual([
      node('c', [node('d', [], { collapsed: true, note: 'n' })]),
    ]);
  });

  it('replaces the children of the primary root', () => {
    const { map: next, inverse } = applyAndUndo(
      replaceable(),
      replacing('r', [{ id: 'a1', text: 'X' }]),
    );

    expect(next.roots[0]).toStrictEqual({
      id: 'r',
      text: 'R',
      children: [{ id: 'a1', text: 'X', children: [] }],
    });
    expect(inverse).toHaveLength(1);
  });

  it('replaces the children of a floating root and keeps its position', () => {
    const { map: next } = applyAndUndo(replaceable(), replacing('f', [{ id: 'fx', text: 'FX2' }]));

    expect(next.roots[1]).toStrictEqual({
      id: 'f',
      text: 'F',
      position: { x: 7, y: 8 },
      children: [{ id: 'fx', text: 'FX2', children: [] }],
    });
  });

  it('rejects an unknown parentId with unknown-node', () => {
    expectRejected(replaceable(), replacing('missing', [{ id: 'a', text: 'dup' }]), 'unknown-node');
  });
});
