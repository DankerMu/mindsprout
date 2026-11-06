import { describe, expect, it } from 'vitest';
import { mapOf, node, sampleMap } from '../../../tests/support/map-domain';
import { layoutForest, type NodeSize } from '../../contexts/map/application/layout/layout-forest';
import type { MindMap, NodeId } from '../../contexts/map/domain/types';
import { toFlowElements } from './flow-elements';

// Seam: toFlowElements (design "Fixture — issue #15"). Expected values come from the fixture's
// rules (one node per laid-out id, data from the map, edge id = target) and from layoutForest's
// output as the input under translation, never from running toFlowElements.

// The canvas lays out with the same measured sizes it hands to toFlowElements.
function elementsOf(map: MindMap, measured: ReadonlyMap<NodeId, NodeSize> = new Map()) {
  const layout = layoutForest(map, { direction: 'LR', nodeSize: measured });
  return { layout, ...toFlowElements(map, layout, measured) };
}

function keysById(map: MindMap, measured: ReadonlyMap<NodeId, NodeSize>) {
  return elementsOf(map, measured).nodes.map((flowNode) => [flowNode.id, Object.keys(flowNode)]);
}

const PLAIN_KEYS = ['id', 'type', 'position', 'data'];

function dataOf(map: MindMap, id: string) {
  const found = elementsOf(map).nodes.find((flowNode) => flowNode.id === id);
  if (found === undefined) throw new Error(`no flow node ${id}`);
  return found.data;
}

// r ─ c (collapsed) ─ (x1 ─ (x3, x4), x2): four descendants across two levels under c.
function collapsedMap(collapsed: boolean): MindMap {
  return mapOf(
    node('r', [node('c', [node('x1', [node('x3'), node('x4')]), node('x2')], { collapsed })]),
  );
}

describe('toFlowElements', () => {
  it('emits one node per laid-out id, in layout order, at the laid-out position', () => {
    const { layout, nodes } = elementsOf(sampleMap());

    expect(nodes.map(({ id, position }) => [id, position])).toStrictEqual([...layout.positions]);
    expect(nodes.map(({ id }) => id)).toStrictEqual(['r', 'p', 'a', 'b', 'f1', 'fc']);
  });

  it('without measurements, gives every node exactly id, type, position and data', () => {
    const { nodes } = elementsOf(sampleMap());

    for (const flowNode of nodes) {
      expect(Object.keys(flowNode).sort()).toStrictEqual(['data', 'id', 'position', 'type']);
      expect(flowNode.type).toBe('mindNode');
    }
  });

  it('carries a valid measurement as measured on that node only', () => {
    const measured = new Map([['p', { width: 120, height: 32 }]]);
    const { layout, nodes } = elementsOf(sampleMap(), measured);
    const withMeasured = nodes.filter((flowNode) => 'measured' in flowNode);

    expect(withMeasured.map(({ id, measured: size }) => [id, size])).toStrictEqual([
      ['p', { width: 120, height: 32 }],
    ]);
    // Every other node has an estimated layout size, and none of them becomes measured.
    expect(layout.sizes.size).toBe(nodes.length);
    expect(keysById(sampleMap(), measured)).toStrictEqual(
      ['r', 'p', 'a', 'b', 'f1', 'fc'].map((id) => [
        id,
        id === 'p' ? [...PLAIN_KEYS, 'measured'] : PLAIN_KEYS,
      ]),
    );
  });

  it.each([
    ['zero width', { width: 0, height: 32 }],
    ['zero height', { width: 120, height: 0 }],
    ['NaN width', { width: Number.NaN, height: 32 }],
    ['NaN height', { width: 120, height: Number.NaN }],
    ['infinite width', { width: Number.POSITIVE_INFINITY, height: 32 }],
    ['infinite height', { width: 120, height: Number.POSITIVE_INFINITY }],
    ['negative width', { width: -120, height: 32 }],
  ])('never turns a measurement with %s into measured', (_case, size) => {
    const keys = keysById(sampleMap(), new Map([['p', size]]));

    expect(keys).toStrictEqual(['r', 'p', 'a', 'b', 'f1', 'fc'].map((id) => [id, PLAIN_KEYS]));
  });

  it('carries the title, no color, no note and no hidden count for a plain node', () => {
    expect(dataOf(sampleMap(), 'p')).toStrictEqual({
      text: 'P',
      color: null,
      hasNote: false,
      hiddenCount: 0,
    });
  });

  it('sets hasNote only for a non-empty note', () => {
    const map = mapOf(
      node('r', [node('n', [], { note: '备注' }), node('e', [], { note: '' }), node('z')]),
    );

    expect(dataOf(map, 'n').hasNote).toBe(true);
    expect(dataOf(map, 'e').hasNote).toBe(false);
    expect(dataOf(map, 'z').hasNote).toBe(false);
  });

  it('passes the color token through and uses null for no color', () => {
    const map = mapOf(node('r', [node('b', [], { color: 'blue' }), node('z')]));

    expect(dataOf(map, 'b').color).toBe('blue');
    expect(dataOf(map, 'z').color).toBeNull();
  });

  it('counts every descendant of a collapsed node from the map, and hides them', () => {
    const { nodes } = elementsOf(collapsedMap(true));
    const ids = nodes.map(({ id }) => id);

    expect(dataOf(collapsedMap(true), 'c').hiddenCount).toBe(4);
    expect(ids).toStrictEqual(['r', 'c']);
    for (const hidden of ['x1', 'x2', 'x3', 'x4']) expect(ids).not.toContain(hidden);
  });

  it('gives an expanded node a hidden count of 0', () => {
    expect(dataOf(collapsedMap(false), 'c').hiddenCount).toBe(0);
  });

  it('places a floating root at its stored position', () => {
    const map = mapOf(node('r'), node('f', [node('fc')], { position: { x: 300.5, y: -40 } }));

    const floating = elementsOf(map).nodes.find(({ id }) => id === 'f');

    expect(floating?.position).toStrictEqual({ x: 300.5, y: -40 });
  });

  it('emits one edge per laid-out pair, keyed by its target', () => {
    const { edges } = elementsOf(sampleMap());

    expect(edges).toStrictEqual([
      { id: 'p', source: 'r', target: 'p' },
      { id: 'a', source: 'p', target: 'a' },
      { id: 'b', source: 'p', target: 'b' },
      { id: 'fc', source: 'f1', target: 'fc' },
    ]);
  });
});
