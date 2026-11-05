import { expect } from 'vitest';
import { applyOp } from '../../src/contexts/map/domain/apply-op';
import { TreeOpError, type TreeOpErrorCode } from '../../src/contexts/map/domain/errors';
import type { TreeOp } from '../../src/contexts/map/domain/tree-op';
import type { MindMap, MindNode, NodeId } from '../../src/contexts/map/domain/types';

// Shared applyOp test support for the map domain test files (design "Fixture — issue #5").
// Every map handed to applyOp is deep-frozen first, so any in-place write throws, and is compared
// to a structuredClone snapshot afterwards — for applied and rejected ops alike.

export const UPDATED_AT = '2026-11-05T10:00:00.000Z';

export const ORIGIN = { x: 0, y: 0 };

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  Object.freeze(value);
  const children: unknown[] = Object.values(value);
  children.forEach(deepFreeze);
}

export function node(
  id: NodeId,
  children: MindNode[] = [],
  fields: Partial<Omit<MindNode, 'id' | 'children'>> = {},
): MindNode {
  return { id, text: id.toUpperCase(), ...fields, children };
}

export function mapOf(...roots: MindNode[]): MindMap {
  return {
    id: 'm1',
    title: '导图',
    roots,
    createdAt: '2026-11-05T09:00:00.000Z',
    updatedAt: UPDATED_AT,
  };
}

// r ─ p ─ (a, b)          f1 @ (10, 20) ─ fc
export function sampleMap(): MindMap {
  return mapOf(
    node('r', [node('p', [node('a'), node('b')])]),
    node('f1', [node('fc')], { position: { x: 10, y: 20 } }),
  );
}

export function metadataOf({ id, title, createdAt, updatedAt }: MindMap) {
  return { id, title, createdAt, updatedAt };
}

export interface Entry {
  node: MindNode;
  parentId: NodeId | null;
  index: number;
  siblingCount: number;
  depth: number;
}

export function entriesOf(map: MindMap): Entry[] {
  const entries: Entry[] = [];
  const walk = (nodes: readonly MindNode[], parentId: NodeId | null, depth: number): void => {
    nodes.forEach((child, index) => {
      entries.push({ node: child, parentId, index, siblingCount: nodes.length, depth });
      walk(child.children, child.id, depth + 1);
    });
  };
  walk(map.roots, null, 0);
  return entries;
}

export function nodeIn(map: MindMap, id: NodeId): MindNode {
  const found = entriesOf(map).find((entry) => entry.node.id === id);
  if (found === undefined) throw new Error(`node ${id} is not in the map`);
  return found.node;
}

export function idsOf(nodes: readonly { id: NodeId }[]): NodeId[] {
  return nodes.map((child) => child.id);
}

// Design D1 on a reducer result: roots[0] unpositioned, every floating root at a finite position,
// no tree node positioned, ids unique, and canonical collapsed (never `collapsed: false`).
function expectForest(map: MindMap): void {
  const entries = entriesOf(map);
  expect(map.roots.length).toBeGreaterThan(0);
  for (const { node: current, parentId, index } of entries) {
    const floating = parentId === null && index > 0;
    if (floating) {
      expect(Number.isFinite(current.position?.x)).toBe(true);
      expect(Number.isFinite(current.position?.y)).toBe(true);
    } else {
      expect(current).not.toHaveProperty('position');
    }
    expect(current.collapsed).not.toBe(false);
  }
  const ids = idsOf(entries.map((entry) => entry.node));
  expect(new Set(ids).size).toBe(ids.length);
}

// "Input map is untouched" + "Reducer leaves metadata untouched" + D1, asserted on every applied op.
export function apply(map: MindMap, op: TreeOp): { map: MindMap; inverse: TreeOp[] } {
  deepFreeze(map);
  const before = structuredClone(map);
  const result = applyOp(map, op);
  expect(map).toStrictEqual(before);
  expect(metadataOf(result.map)).toStrictEqual(metadataOf(before));
  expectForest(result.map);
  return result;
}

export function undo(map: MindMap, inverse: readonly TreeOp[]): MindMap {
  return inverse.reduce((current, op) => apply(current, op).map, map);
}

export function applyAndUndo(map: MindMap, op: TreeOp): { map: MindMap; inverse: TreeOp[] } {
  const result = apply(map, op);
  expect(undo(result.map, result.inverse)).toStrictEqual(map);
  return result;
}

export function rejection(map: MindMap, op: unknown): TreeOpError {
  deepFreeze(map);
  const before = structuredClone(map);
  try {
    applyOp(map, op as TreeOp);
  } catch (error) {
    expect(map).toStrictEqual(before);
    if (error instanceof TreeOpError) return error;
    throw error;
  }
  throw new Error('expected applyOp to reject the op');
}

export function expectRejected(map: MindMap, op: unknown, code: TreeOpErrorCode): void {
  expect(rejection(map, op).code).toBe(code);
}
