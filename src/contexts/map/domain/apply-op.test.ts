import { describe, expect, it } from 'vitest';
import {
  ORIGIN,
  UPDATED_AT,
  apply,
  applyAndUndo,
  entriesOf,
  expectRejected,
  idsOf,
  mapOf,
  metadataOf,
  node,
  nodeIn,
  rejection,
  sampleMap,
  undo,
} from '../../../../tests/support/map-domain';
import type { TreeOp } from './tree-op';
import type { MindMap, MindNode, NewNode, NodeId } from './types';

// Seam under test: applyOp only (design "Fixture — issue #4"): add_children, add_root, update_node,
// delete_node, validation and metadata. move_node / set_root_position / replace_children live in
// apply-op-reshape.test.ts, the seven-op round-trip property in apply-op-round-trip.test.ts; the
// frozen-input, metadata and D1 assertions run inside the shared helpers (tests/support).

function addingRoot(newNode: NewNode, index?: number): TreeOp {
  return {
    op: 'add_root',
    node: newNode,
    position: ORIGIN,
    ...(index === undefined ? {} : { index }),
  };
}

function addingChildren(parentId: NodeId, children: NewNode[], index?: number): TreeOp {
  return { op: 'add_children', parentId, children, ...(index === undefined ? {} : { index }) };
}

describe('applyOp — add_root', () => {
  it('Floating root carries a position', () => {
    const map = mapOf(node('r', [node('a')]));

    const { map: next, inverse } = applyAndUndo(map, {
      op: 'add_root',
      node: { id: 'f1', text: '灵感' },
      position: { x: 120, y: 40 },
    });

    expect(next.roots).toHaveLength(2);
    expect(next.roots[1]).toStrictEqual({
      id: 'f1',
      text: '灵感',
      position: { x: 120, y: 40 },
      children: [],
    });
    expect(next.roots[0]).toStrictEqual({
      id: 'r',
      text: 'R',
      children: [{ id: 'a', text: 'A', children: [] }],
    });
    expect(inverse).toStrictEqual([{ op: 'delete_node', id: 'f1' }]);
  });

  it.each([
    ['at a middle roots index', 1, ['r', 'mid', 'f1', 'f2']],
    ['at index == roots.length (append)', 3, ['r', 'f1', 'f2', 'mid']],
    ['without an index (append)', undefined, ['r', 'f1', 'f2', 'mid']],
  ])('inserts %s', (_label, index, expected) => {
    const map = mapOf(
      node('r'),
      node('f1', [], { position: ORIGIN }),
      node('f2', [], { position: ORIGIN }),
    );

    const { map: next } = applyAndUndo(map, addingRoot({ id: 'mid', text: '' }, index));

    expect(idsOf(next.roots)).toStrictEqual(expected);
  });

  it.each([
    ['index 0 (the primary slot)', 0],
    ['index beyond roots.length', 3],
  ])('rejects %s with invalid-target', (_label, index) => {
    expectRejected(sampleMap(), addingRoot({ id: 'z', text: 'Z' }, index), 'invalid-target');
  });

  it.each([
    ['the root node itself', { id: 'a', text: 'dup' }],
    ['a nested payload node', { id: 'z', text: 'Z', children: [{ id: 'fc', text: 'dup' }] }],
  ])('rejects an existing id on %s with invalid-target', (_label, payload: NewNode) => {
    expectRejected(sampleMap(), addingRoot(payload), 'invalid-target');
  });

  it('stores collapsed: true and drops collapsed: false on the inserted subtree', () => {
    const payload = {
      id: 'z',
      text: 'Z',
      collapsed: true,
      children: [{ id: 'zc', text: 'ZC', collapsed: false }],
    };

    const { map: next } = applyAndUndo(sampleMap(), addingRoot(payload));

    expect(next.roots[2]).toStrictEqual(
      node('z', [node('zc')], { collapsed: true, position: ORIGIN }),
    );
  });
});

describe('applyOp — add_children', () => {
  it('Inverse of a multi-child add', () => {
    const map = sampleMap();

    const { map: next, inverse } = apply(
      map,
      addingChildren('p', [
        { id: 'x', text: 'X' },
        { id: 'y', text: 'Y' },
      ]),
    );

    expect(idsOf(nodeIn(next, 'p').children)).toStrictEqual(['a', 'b', 'x', 'y']);
    expect(inverse).toStrictEqual([
      { op: 'delete_node', id: 'y' },
      { op: 'delete_node', id: 'x' },
    ]);
    const restored = undo(next, inverse);
    expect(nodeIn(restored, 'p').children).toStrictEqual([node('a'), node('b')]);
    expect(restored).toStrictEqual(map);
  });

  it('Add a subtree in one op', () => {
    const subtree: NewNode = {
      id: 'c',
      text: 'C',
      collapsed: true,
      children: [
        { id: 'g1', text: 'G1' },
        { id: 'g2', text: 'G2', note: 'n', color: 'green' },
      ],
    };

    const { map: next } = applyAndUndo(sampleMap(), addingChildren('p', [subtree]));

    const grandchildren = [node('g1'), node('g2', [], { note: 'n', color: 'green' })];
    expect(nodeIn(next, 'c')).toStrictEqual(node('c', grandchildren, { collapsed: true }));
    expect(idsOf(nodeIn(next, 'p').children)).toStrictEqual(['a', 'b', 'c']);
  });

  it('Expanded is stored as no flag (NewNode carrying collapsed: false)', () => {
    const { map: next } = applyAndUndo(
      sampleMap(),
      addingChildren('p', [{ id: 'e', text: 'E', collapsed: false }]),
    );

    expect(nodeIn(next, 'e')).toStrictEqual({ id: 'e', text: 'E', children: [] });
  });

  it.each([
    ['first (index 0)', 0, ['new', 'a', 'b']],
    ['middle (index 1)', 1, ['a', 'new', 'b']],
    ['last (index == children.length)', 2, ['a', 'b', 'new']],
  ])('inserts %s', (_label, index, expected) => {
    const { map: next } = applyAndUndo(
      sampleMap(),
      addingChildren('p', [{ id: 'new', text: '' }], index),
    );

    expect(idsOf(nodeIn(next, 'p').children)).toStrictEqual(expected);
  });

  it.each(['r', 'f1', 'a'])('adds under %s (primary root, floating root, leaf)', (parentId) => {
    const { map: next } = applyAndUndo(
      sampleMap(),
      addingChildren(parentId, [{ id: 'new', text: 'NEW' }]),
    );

    expect(nodeIn(next, parentId).children.at(-1)).toStrictEqual(node('new'));
  });

  it('rejects index > children.length with invalid-target', () => {
    expectRejected(sampleMap(), addingChildren('p', [{ id: 'x', text: 'X' }], 3), 'invalid-target');
  });

  it.each(['r', 'b', 'f1', 'fc'])('Duplicate id on add (existing id %s)', (id) => {
    expectRejected(sampleMap(), addingChildren('p', [{ id, text: 'dup' }]), 'invalid-target');
  });

  it.each([
    [
      'siblings',
      [
        { id: 'x', text: '1' },
        { id: 'x', text: '2' },
      ],
    ],
    [
      'different nesting',
      [
        {
          id: 'x',
          text: '1',
          children: [{ id: 'y', text: '2', children: [{ id: 'x', text: '3' }] }],
        },
      ],
    ],
  ])('Duplicate id inside one payload (%s)', (_label, children: NewNode[]) => {
    expectRejected(sampleMap(), addingChildren('p', children), 'invalid-target');
  });
});

describe('applyOp — update_node', () => {
  const rich = { color: 'blue', note: 'old note', collapsed: true } as const;
  const colored = (): MindMap => mapOf(node('r', [node('n', [node('k')], rich)]));
  const plain = (): MindMap => mapOf(node('r', [node('n', [node('k')])]));

  it.each([
    [
      'Clear a color',
      colored,
      { color: null },
      { color: 'blue' },
      { note: 'old note', collapsed: true },
    ],
    [
      'Inverse of setting a color on an uncoloured node',
      plain,
      { color: 'green' },
      { color: null },
      { color: 'green' },
    ],
    [
      'clear a note',
      colored,
      { note: null },
      { note: 'old note' },
      { color: 'blue', collapsed: true },
    ],
    [
      'set a note on a node without one',
      plain,
      { note: 'fresh' },
      { note: null },
      { note: 'fresh' },
    ],
    [
      'Expanded is stored as no flag (expand)',
      colored,
      { collapsed: false },
      { collapsed: true },
      { color: 'blue', note: 'old note' },
    ],
    [
      'Expanded is stored as no flag (collapse)',
      plain,
      { collapsed: true },
      { collapsed: false },
      { collapsed: true },
    ],
    [
      'rename keeps every other field',
      colored,
      { text: '新' },
      { text: 'N' },
      { text: '新', ...rich },
    ],
  ] as const)('%s', (_label, makeMap, patch, inversePatch, expectedFields) => {
    const { map: next, inverse } = applyAndUndo(makeMap(), {
      op: 'update_node',
      id: 'n',
      ...patch,
    });

    expect(nodeIn(next, 'n')).toStrictEqual({
      id: 'n',
      text: 'N',
      ...expectedFields,
      children: [node('k')],
    });
    expect(inverse).toStrictEqual([{ op: 'update_node', id: 'n', ...inversePatch }]);
  });

  it('inverse carries exactly the fields the op carried, each with its previous value', () => {
    const op: TreeOp = {
      op: 'update_node',
      id: 'n',
      text: 'T',
      note: 'x',
      color: null,
      collapsed: true,
    };

    const { inverse } = applyAndUndo(colored(), op);

    expect(inverse).toStrictEqual([{ op: 'update_node', id: 'n', text: 'N', ...rich }]);
  });

  it('keeps a floating root position when it is updated', () => {
    const { map: next } = applyAndUndo(sampleMap(), { op: 'update_node', id: 'f1', text: '浮' });

    expect(next.roots[1]).toStrictEqual({
      id: 'f1',
      text: '浮',
      position: { x: 10, y: 20 },
      children: [node('fc')],
    });
  });

  it('Renaming the primary root', () => {
    const { map: next } = applyAndUndo(sampleMap(), { op: 'update_node', id: 'r', text: '新标题' });

    expect(next.roots[0]?.text).toBe('新标题');
    expect(next.roots[0]?.children).toStrictEqual([node('p', [node('a'), node('b')])]);
  });

  it('Unknown node id', () => {
    expectRejected(sampleMap(), { op: 'update_node', id: 'missing', text: 'x' }, 'unknown-node');
  });
});

describe('applyOp — delete_node', () => {
  it('Delete a node with children', () => {
    // N is the middle of three siblings with three descendants (c1 → c2, c3).
    const subtree = (): MindNode => node('n', [node('c1', [node('c2')]), node('c3')]);
    const map = mapOf(node('r', [node('p', [node('a'), subtree(), node('b')])]));

    const { map: next, inverse } = applyAndUndo(map, { op: 'delete_node', id: 'n' });

    expect(idsOf(entriesOf(next).map((entry) => entry.node))).toStrictEqual(['r', 'p', 'a', 'b']);
    expect(inverse).toStrictEqual([
      { op: 'add_children', parentId: 'p', index: 1, children: [subtree()] },
    ]);
    expect(idsOf(nodeIn(undo(next, inverse), 'p').children)).toStrictEqual(['a', 'n', 'b']);
  });

  it('Delete a collapsed node with grandchildren', () => {
    const subtree = (): MindNode =>
      node('n', [node('c', [node('g1'), node('g2')])], { collapsed: true });
    const map = mapOf(node('r', [node('a'), subtree()]));

    const { inverse } = applyAndUndo(map, { op: 'delete_node', id: 'n' });

    expect(inverse).toStrictEqual([
      {
        op: 'add_children',
        parentId: 'r',
        index: 1,
        children: [
          { id: 'n', text: 'N', collapsed: true, children: [node('c', [node('g1'), node('g2')])] },
        ],
      },
    ]);
  });

  it('Delete a floating root', () => {
    const map = mapOf(
      node('r'),
      node('f1', [], { position: { x: 1, y: 1 } }),
      node('f', [node('fa'), node('fb')], { position: { x: 300, y: 200 } }),
      node('f3', [], { position: { x: 3, y: 3 } }),
    );

    const { map: next, inverse } = applyAndUndo(map, { op: 'delete_node', id: 'f' });

    expect(idsOf(next.roots)).toStrictEqual(['r', 'f1', 'f3']);
    expect(entriesOf(next).some((entry) => ['f', 'fa', 'fb'].includes(entry.node.id))).toBe(false);
    expect(inverse).toStrictEqual([
      {
        op: 'add_root',
        node: node('f', [node('fa'), node('fb')]),
        position: { x: 300, y: 200 },
        index: 2,
      },
    ]);
    const restored = undo(next, inverse);
    expect(idsOf(restored.roots)).toStrictEqual(['r', 'f1', 'f', 'f3']);
    expect(restored.roots[2]?.position).toStrictEqual({ x: 300, y: 200 });
  });

  it('round-trips a node carrying note, color and collapsed whose child carries note and color', () => {
    const child = node('c', [], { note: 'child note', color: 'purple' });
    const map = mapOf(
      node('r', [node('n', [child], { note: 'line 1\nline 2', color: 'red', collapsed: true })]),
    );

    const { inverse } = applyAndUndo(map, { op: 'delete_node', id: 'n' });

    const restoredChild = { id: 'c', text: 'C', note: 'child note', color: 'purple', children: [] };
    const restored = {
      id: 'n',
      text: 'N',
      note: 'line 1\nline 2',
      color: 'red',
      collapsed: true,
      children: [restoredChild],
    };
    expect(inverse).toStrictEqual([
      { op: 'add_children', parentId: 'r', index: 0, children: [restored] },
    ]);
  });

  it('Deleting the primary root', () => {
    expectRejected(sampleMap(), { op: 'delete_node', id: 'r' }, 'primary-root-protected');
  });

  it('rejects a floating root without a position (corrupt map) with invalid-target', () => {
    expectRejected(mapOf(node('r'), node('f')), { op: 'delete_node', id: 'f' }, 'invalid-target');
  });
});

describe('applyOp — validation', () => {
  it.each([
    ['add_children parentId', addingChildren('missing', [{ id: 'x', text: 'X' }])],
    ['delete_node id', { op: 'delete_node', id: 'missing' }],
    [
      'parentId checked before index range and duplicates',
      addingChildren('missing', [{ id: 'a', text: 'dup' }], 9),
    ],
  ])('Unknown node id (%s)', (_label, op) => {
    expectRejected(sampleMap(), op, 'unknown-node');
  });

  it.each([
    ['missing id', { op: 'delete_node' }],
    ['unknown op', { op: 'rename_node', id: 'a' }],
    [
      'position on a creation payload',
      { op: 'add_children', parentId: 'p', children: [{ id: 'x', text: 'X', position: ORIGIN }] },
    ],
    ['malformed and targeting a missing node', { op: 'update_node', id: 'missing' }],
  ])('rejects a cast malformed op (%s) with invalid-op carrying schema issues', (_label, op) => {
    const error = rejection(sampleMap(), op);

    expect(error.code).toBe('invalid-op');
    expect(error.issues?.length).toBeGreaterThan(0);
  });
});

describe('applyOp — Reducer leaves metadata untouched', () => {
  it.each<TreeOp>([
    { op: 'add_children', parentId: 'p', children: [{ id: 'x', text: 'X' }] },
    { op: 'add_root', node: { id: 'z', text: 'Z' }, position: { x: 0, y: 0 } },
    { op: 'update_node', id: 'a', text: 'renamed' },
    { op: 'delete_node', id: 'b' },
    { op: 'move_node', id: 'a', newParentId: 'fc' },
    { op: 'move_node', id: 'a', newParentId: null, position: { x: 1, y: 2 } },
    { op: 'set_root_position', id: 'f1', position: { x: 5, y: 6 } },
    { op: 'replace_children', parentId: 'p', children: [{ id: 'a', text: 'A2' }] },
  ])('$op keeps id, title, createdAt and updatedAt', (op) => {
    const { map: next } = applyAndUndo(sampleMap(), op);

    expect(metadataOf(next)).toStrictEqual({
      id: 'm1',
      title: '导图',
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: UPDATED_AT,
    });
  });
});
