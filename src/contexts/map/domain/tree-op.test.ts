import { describe, expect, expectTypeOf, it } from 'vitest';
import { TreeOpError } from './errors';
import {
  addChildrenOp,
  addRootOp,
  deleteNodeOp,
  moveNodeOp,
  parseTreeOp,
  replaceChildrenOp,
  setRootPositionOp,
  treeOpSchema,
  updateNodeOp,
  type TreeOp,
} from './tree-op';
import type { NewNode, Position } from './types';

function rejectionOf(input: unknown): TreeOpError {
  try {
    parseTreeOp(input);
  } catch (error) {
    if (error instanceof TreeOpError) return error;
    throw error;
  }
  throw new Error('expected parseTreeOp to reject the payload');
}

function expectInvalidOp(input: unknown): void {
  const error = rejectionOf(input);
  expect(error.code).toBe('invalid-op');
  expect(error.issues?.length).toBeGreaterThan(0);
}

const minimalOps = {
  add_children: { op: 'add_children', parentId: 'p1', children: [{ id: 'n1', text: 'a' }] },
  add_root: { op: 'add_root', node: { id: 'f1', text: '灵感' }, position: { x: 120, y: 40 } },
  update_node: { op: 'update_node', id: 'n1', text: 'b' },
  delete_node: { op: 'delete_node', id: 'n1' },
  move_node: { op: 'move_node', id: 'n1', newParentId: 'p1' },
  set_root_position: { op: 'set_root_position', id: 'f1', position: { x: 0, y: -5.5 } },
  replace_children: { op: 'replace_children', parentId: 'p1', children: [] },
} as const;

const opSchemas = {
  add_children: addChildrenOp,
  add_root: addRootOp,
  update_node: updateNodeOp,
  delete_node: deleteNodeOp,
  move_node: moveNodeOp,
  set_root_position: setRootPositionOp,
  replace_children: replaceChildrenOp,
};

const opNames = Object.keys(minimalOps) as (keyof typeof minimalOps)[];

describe('parseTreeOp — accepts every op shape', () => {
  it.each(opNames)('%s: minimal payload parses and round-trips structurally equal', (name) => {
    const payload = minimalOps[name];

    expect(parseTreeOp(payload)).toEqual(payload);
    expect(opSchemas[name].parse(payload)).toEqual(payload);
    expect(treeOpSchema.parse(payload)).toEqual(payload);
  });

  it('accepts an empty-text NewNode in add_children (createNode)', () => {
    const op = { op: 'add_children', parentId: 'p1', children: [{ id: 'n1', text: '' }] };

    expect(parseTreeOp(op)).toEqual(op);
  });

  it('accepts a full nested subtree at an index (deleted-subtree inverse shape)', () => {
    const subtree: NewNode = {
      id: 'n1',
      text: 'N',
      note: 'line 1\nline 2',
      color: 'blue',
      collapsed: true,
      children: [
        {
          id: 'c1',
          text: 'C',
          children: [
            { id: 'g1', text: 'G1' },
            { id: 'g2', text: 'G2' },
          ],
        },
      ],
    };
    const op = { op: 'add_children', parentId: 'p1', children: [subtree], index: 2 };

    expect(parseTreeOp(op)).toEqual(op);
  });

  it('accepts add_root carrying a subtree and an index', () => {
    const op = {
      op: 'add_root',
      node: { id: 'f1', text: 'F', children: [{ id: 'c1', text: '' }] },
      position: { x: 300, y: 200 },
      index: 2,
    };

    expect(parseTreeOp(op)).toEqual(op);
  });

  it('accepts update_node clearing note and color and resetting collapsed', () => {
    const op = { op: 'update_node', id: 'n1', note: null, color: null, collapsed: false };

    expect(parseTreeOp(op)).toEqual(op);
  });

  it('accepts update_node with an empty text', () => {
    const op = { op: 'update_node', id: 'n1', text: '' };

    expect(parseTreeOp(op)).toEqual(op);
  });

  it('accepts move_node detaching into a floating root with position and index', () => {
    const op = {
      op: 'move_node',
      id: 'n1',
      newParentId: null,
      position: { x: 300, y: 200 },
      index: 2,
    };

    expect(parseTreeOp(op)).toEqual(op);
  });

  it('accepts move_node reparenting at an index, including index 0', () => {
    const op = { op: 'move_node', id: 'n1', newParentId: 'p1', index: 0 };

    expect(parseTreeOp(op)).toEqual(op);
  });

  it('types move_node as a union discriminated on newParentId', () => {
    type MoveOp = Extract<TreeOp, { op: 'move_node' }>;
    expectTypeOf<Extract<MoveOp, { newParentId: null }>>().toEqualTypeOf<{
      op: 'move_node';
      id: string;
      newParentId: null;
      position: Position;
      index?: number;
    }>();
    expectTypeOf<Extract<MoveOp, { newParentId: string }>>().toEqualTypeOf<{
      op: 'move_node';
      id: string;
      newParentId: string;
      index?: number;
    }>();
  });
});

describe('parseTreeOp — rejects malformed payloads with invalid-op', () => {
  it('Malformed payload: move_node without id', () => {
    expectInvalidOp({ op: 'move_node', newParentId: 'p1' });
  });

  it('Creation payload cannot carry a position: add_children child with position', () => {
    expectInvalidOp({
      op: 'add_children',
      parentId: 'p1',
      children: [{ id: 'n1', text: 'a', position: { x: 1, y: 2 } }],
    });
  });

  it('rejects a position nested deeper in a creation payload and on add_root / replace_children nodes', () => {
    const withPosition = { id: 'g1', text: 'g', position: { x: 1, y: 2 } };
    expectInvalidOp({
      op: 'add_children',
      parentId: 'p1',
      children: [{ id: 'n1', text: 'a', children: [withPosition] }],
    });
    expectInvalidOp({ op: 'add_root', node: withPosition, position: { x: 1, y: 2 } });
    expectInvalidOp({ op: 'replace_children', parentId: 'p1', children: [withPosition] });
  });

  it('Detach without a position: move_node newParentId null and no position', () => {
    expectInvalidOp({ op: 'move_node', id: 'n1', newParentId: null });
  });

  it('Reparent with a position: move_node newParentId p1 with position', () => {
    expectInvalidOp({ op: 'move_node', id: 'n1', newParentId: 'p1', position: { x: 1, y: 2 } });
  });

  it.each(opNames)('%s: an unknown key is rejected', (name) => {
    expectInvalidOp({ ...minimalOps[name], extra: true });
  });

  it('rejects update_node with no fields', () => {
    expectInvalidOp({ op: 'update_node', id: 'n1' });
  });

  it('rejects an explicitly undefined optional field', () => {
    expectInvalidOp({ op: 'update_node', id: 'n1', text: undefined });
  });

  it('rejects add_children with an empty children list', () => {
    expectInvalidOp({ op: 'add_children', parentId: 'p1', children: [] });
  });

  it.each([-1, 1.5])('rejects index %s on every op that takes one', (index) => {
    expectInvalidOp({ ...minimalOps.add_children, index });
    expectInvalidOp({ ...minimalOps.add_root, index });
    expectInvalidOp({ ...minimalOps.move_node, index });
    expectInvalidOp({
      op: 'move_node',
      id: 'n1',
      newParentId: null,
      position: { x: 0, y: 0 },
      index,
    });
  });

  it('rejects non-finite or incomplete positions', () => {
    expectInvalidOp({ op: 'set_root_position', id: 'f1', position: { x: Infinity, y: 0 } });
    expectInvalidOp({ op: 'set_root_position', id: 'f1', position: { x: Number.NaN, y: 0 } });
    expectInvalidOp({ op: 'set_root_position', id: 'f1', position: { x: 1 } });
    expectInvalidOp({ op: 'add_root', node: { id: 'f1', text: 'F' } });
  });

  it('rejects a color outside the six tokens and a non-string text', () => {
    expectInvalidOp({ op: 'update_node', id: 'n1', color: 'pink' });
    expectInvalidOp({ op: 'update_node', id: 'n1', text: 42 });
    expectInvalidOp({ op: 'update_node', id: 'n1', collapsed: null });
  });

  it('rejects an unknown op name and non-object input', () => {
    expectInvalidOp({ op: 'rename_map', title: 'x' });
    expectInvalidOp(null);
    expectInvalidOp('delete_node');
  });

  it('reports the offending path in the error message', () => {
    const error = rejectionOf({ op: 'delete_node' });

    expect(error.message).toContain('id');
  });

  it('validates the op alone — its only input is the payload, never a map', () => {
    expect(parseTreeOp.length).toBe(1);
    expectTypeOf(parseTreeOp).parameters.toEqualTypeOf<[input: unknown]>();
    expectTypeOf(parseTreeOp).returns.toEqualTypeOf<TreeOp>();
  });
});
