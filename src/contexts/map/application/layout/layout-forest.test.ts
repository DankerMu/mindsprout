import { describe, expect, it } from 'vitest';
import { deepFreeze, mapOf, node, sampleMap } from '../../../../../tests/support/map-domain';
import type { MindMap, MindNode, NodeId } from '../../domain/types';
import {
  DEFAULT_GAP,
  estimateNodeSize,
  layoutForest,
  type ForestLayout,
  type LayoutOptions,
  type NodeSize,
} from './layout-forest';

// Seams: layoutForest and estimateNodeSize (design "Fixture — issue #8"). Expected values come
// from the fixture's formulas (columns, estimate) and the spec canvas-layout scenarios, never from
// running the implementation.

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LR = { direction: 'LR' } as const;

function layout(map: MindMap, options: Partial<LayoutOptions> = {}): ForestLayout {
  return layoutForest(map, { ...LR, ...options });
}

function boxOf(result: ForestLayout, id: NodeId): Box {
  const position = result.positions.get(id);
  const size = result.sizes.get(id);
  if (position === undefined || size === undefined) throw new Error(`node ${id} is not laid out`);
  return { ...position, ...size };
}

function centreY(box: Box): number {
  return box.y + box.height / 2;
}

// Open intervals on both axes: boxes that only touch do not intersect.
function intersects(a: Box, b: Box): boolean {
  const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
  const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
  return overlapX && overlapY;
}

function expectNoIntersections(result: ForestLayout): void {
  const ids = [...result.positions.keys()];
  ids.forEach((a, i) => {
    ids.slice(i + 1).forEach((b) => {
      expect(intersects(boxOf(result, a), boxOf(result, b)), `${a} ∩ ${b}`).toBe(false);
    });
  });
}

function preOrder(nodes: readonly MindNode[], visible: boolean): MindNode[] {
  return nodes.flatMap((current) => [
    current,
    ...(visible && current.collapsed === true ? [] : preOrder(current.children, visible)),
  ]);
}

// Governing invariant (fixture): pairwise non-intersection, every child entirely right of its
// parent, siblings stacked top-to-bottom in children order, hidden nodes without a position.
function expectGoverningInvariant(map: MindMap, result: ForestLayout): void {
  const [primary] = map.roots;
  if (primary === undefined) throw new Error('map has no primary root');
  const visible = preOrder([primary], true);
  const visibleIds = new Set(visible.map((current) => current.id));
  expect([...result.positions.keys()]).toStrictEqual([...visibleIds]);
  for (const hidden of preOrder(map.roots, false)) {
    if (!visibleIds.has(hidden.id)) expect(result.positions.has(hidden.id)).toBe(false);
  }
  expectNoIntersections(result);
  for (const parent of visible) {
    if (parent.collapsed === true) continue;
    const parentBox = boxOf(result, parent.id);
    const childBoxes = parent.children.map((child) => boxOf(result, child.id));
    for (const childBox of childBoxes) {
      expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x + parentBox.width);
    }
    let previousBottom = Number.NEGATIVE_INFINITY;
    for (const childBox of childBoxes) {
      expect(childBox.y).toBeGreaterThanOrEqual(previousBottom);
      previousBottom = childBox.y + childBox.height;
    }
  }
}

// d3 centres parents and spreads shifts with fractional arithmetic; the tolerance absorbs rounding
// only and is far below any gap the cases use.
const ROUNDING = 1e-9;

// Fixture rows: adjacent same-depth nodes (siblings or cousins) are at least
// (h_a + h_b) / 2 + gap apart centre to centre, so the space between their boxes is at least gap.
// Lower bound only, never exact spacing. Returns the number of pairs checked.
function expectRowGaps(map: MindMap, result: ForestLayout, gap: number): number {
  const [primary] = map.roots;
  if (primary === undefined) throw new Error('map has no primary root');
  const rows: Box[][] = [];
  const walk = (current: MindNode, depth: number): void => {
    (rows[depth] ??= []).push(boxOf(result, current.id));
    if (current.collapsed === true) return;
    for (const child of current.children) walk(child, depth + 1);
  };
  walk(primary, 0);
  let pairs = 0;
  for (const row of rows) {
    row.reduce((previous, next) => {
      expect(next.y - (previous.y + previous.height)).toBeGreaterThanOrEqual(gap - ROUNDING);
      pairs += 1;
      return next;
    });
  }
  return pairs;
}

function sizesOf(entries: [NodeId, NodeSize][]): Map<NodeId, NodeSize> {
  return new Map(entries);
}

describe('layoutForest — spec canvas-layout scenarios', () => {
  it('Three-level tree renders without overlap', () => {
    const map = mapOf(
      node('r', [node('a', [node('a1'), node('a2')]), node('b', [node('b1')])], { text: '根' }),
    );
    const result = layout(map);

    expectGoverningInvariant(map, result);
    for (const [parent, child] of [
      ['r', 'a'],
      ['r', 'b'],
      ['a', 'a1'],
      ['a', 'a2'],
      ['b', 'b1'],
    ] as const) {
      const parentBox = boxOf(result, parent);
      expect(boxOf(result, child).x).toBeGreaterThan(parentBox.x + parentBox.width);
    }
    expect(boxOf(result, 'a').y).toBeLessThan(boxOf(result, 'b').y);
    expect(boxOf(result, 'a1').y).toBeLessThan(boxOf(result, 'a2').y);
    expect(boxOf(result, 'a2').y).toBeLessThan(boxOf(result, 'b1').y);
  });

  it('Adding a child reflows siblings', () => {
    const before = layout(mapOf(node('r', [node('p', [node('a')])])));
    const map = mapOf(node('r', [node('p', [node('a'), node('b')])]));
    const after = layout(map);

    const a = boxOf(after, 'a');
    const b = boxOf(after, 'b');
    expect(intersects(a, b)).toBe(false);
    expectGoverningInvariant(map, after);
    expect(centreY(boxOf(after, 'p'))).toBeCloseTo((centreY(a) + centreY(b)) / 2, 9);
    expect(after.positions.get('a')).not.toStrictEqual(before.positions.get('a'));
  });

  it('Measured size replaces the estimate', () => {
    const map = mapOf(node('r', [node('p', [node('c1'), node('c2')]), node('q', [node('d1')])]));
    const measured = estimateNodeSize('P').width + 300;

    const estimated = layout(map);
    const p = boxOf(estimated, 'p');
    expect(boxOf(estimated, 'c1').x).toBeLessThan(p.x + measured);

    const result = layout(map, { nodeSize: sizesOf([['p', { width: measured, height: 32 }]]) });
    const right = boxOf(result, 'p').x + measured;
    for (const id of ['c1', 'c2', 'd1']) {
      expect(boxOf(result, id).x).toBeGreaterThanOrEqual(right + DEFAULT_GAP);
    }
    expectGoverningInvariant(map, result);
  });

  it('Re-layout without changes yields identical positions, sizes and edges', () => {
    const map = sampleMap();
    const entries: [NodeId, NodeSize][] = [
      ['p', { width: 150, height: 120 }],
      ['a', { width: 90, height: 20 }],
    ];
    const first = layout(map, { nodeSize: sizesOf(entries) });
    const second = layout(map, { nodeSize: sizesOf(entries) });
    const copied = layout(map, {
      nodeSize: sizesOf(entries.map(([id, size]) => [id, { ...size }])),
    });

    expect(second).toStrictEqual(first);
    expect(copied).toStrictEqual(first);
    expect(layout(sampleMap())).toStrictEqual(layout(sampleMap()));
  });
});

describe('layoutForest — coordinate convention', () => {
  it('places the primary root top-left at the origin, with and without children', () => {
    expect(layout(mapOf(node('r'))).positions.get('r')).toStrictEqual({ x: 0, y: 0 });
    const map = mapOf(node('r', [node('a', [node('a1')]), node('b')]));
    const nodeSize = sizesOf([
      ['r', { width: 60, height: 20 }],
      ['a', { width: 80, height: 120 }],
    ]);
    expect(layout(map, { nodeSize }).positions.get('r')).toStrictEqual({ x: 0, y: 0 });
    expect(layout(map).positions.get('r')).toStrictEqual({ x: 0, y: 0 });
  });

  // Bite (i): columns case (a).
  it('starts every column after the widest node of the previous depth', () => {
    const longTitle = 'A rather long Latin title that is much wider than its sibling';
    const map = mapOf(
      node('r', [
        node('a', [], { text: longTitle }),
        node('b', [node('b1'), node('b2'), node('b3'), node('b4'), node('b5')], { text: 'B' }),
      ]),
    );
    const result = layout(map);
    const a = boxOf(result, 'a');
    const b = boxOf(result, 'b');
    expect(a.width).toBeGreaterThan(b.width + DEFAULT_GAP);

    for (const id of ['b1', 'b2', 'b3', 'b4', 'b5']) {
      const child = boxOf(result, id);
      expect(child.x).toBeGreaterThanOrEqual(a.x + a.width);
      expect(intersects(child, a)).toBe(false);
    }
    const root = boxOf(result, 'r');
    expect(a.x).toBe(root.width + DEFAULT_GAP);
    expect(boxOf(result, 'b1').x).toBe(root.width + DEFAULT_GAP + a.width + DEFAULT_GAP);
    expectGoverningInvariant(map, result);
  });

  // Bite (ii): mixed-height case (b).
  it('keeps adjacent siblings and same-depth cousins apart with mixed heights', () => {
    const map = mapOf(
      node('r', [node('p', [node('p1'), node('p2')]), node('q', [node('q1'), node('q2')])]),
    );
    const nodeSize = sizesOf([['p2', { width: 60, height: 120 }]]);
    const result = layout(map, { nodeSize });

    expect(result.sizes.get('p2')).toStrictEqual({ width: 60, height: 120 });
    expect(result.sizes.get('q1')).toStrictEqual(estimateNodeSize('Q1'));
    expect(intersects(boxOf(result, 'p1'), boxOf(result, 'p2'))).toBe(false);
    expect(intersects(boxOf(result, 'p2'), boxOf(result, 'q1'))).toBe(false);
    expectGoverningInvariant(map, result);
  });

  it('centres a single child on its parent and stacks a chain on one centre line', () => {
    const map = mapOf(node('r', [node('a', [node('b')])]));
    const nodeSize = sizesOf([
      ['r', { width: 100, height: 40 }],
      ['a', { width: 70, height: 120 }],
      ['b', { width: 50, height: 20 }],
    ]);
    const result = layout(map, { nodeSize, gap: 10 });

    expect(result.positions.get('a')).toStrictEqual({ x: 110, y: -40 });
    expect(result.positions.get('b')).toStrictEqual({ x: 190, y: 10 });
  });

  it('emits one pre-order edge per visible parent-child pair', () => {
    const map = mapOf(node('r', [node('a', [node('a1'), node('a2')]), node('b')]));
    const result = layout(map);

    expect(result.edges).toStrictEqual([
      { source: 'r', target: 'a' },
      { source: 'a', target: 'a1' },
      { source: 'a', target: 'a2' },
      { source: 'r', target: 'b' },
    ]);
    expect([...result.positions.keys()]).toStrictEqual(['r', 'a', 'a1', 'a2', 'b']);
  });
});

describe('layoutForest — scope, collapse and purity', () => {
  // Bite (iii).
  it('gives a collapsed node a position and its four descendants none', () => {
    const collapsedChild = node('c', [node('d1', [node('d2'), node('d3')]), node('d4')], {
      collapsed: true,
    });
    const result = layout(mapOf(node('r', [node('s0'), collapsedChild, node('s1')])));
    const pruned = layout(mapOf(node('r', [node('s0'), node('c'), node('s1')])));

    expect(result.positions.has('c')).toBe(true);
    for (const id of ['d1', 'd2', 'd3', 'd4']) {
      expect(result.positions.has(id)).toBe(false);
      expect(result.sizes.has(id)).toBe(false);
      expect(result.edges.some((edge) => edge.source === id || edge.target === id)).toBe(false);
    }
    expect(result.positions).toStrictEqual(pruned.positions);
    expect(result.edges).toStrictEqual(pruned.edges);
  });

  it('lays out only the primary tree: floating roots get no positions or edges', () => {
    const result = layout(sampleMap());

    expect([...result.positions.keys()]).toStrictEqual(['r', 'p', 'a', 'b']);
    expect([...result.sizes.keys()]).toStrictEqual(['r', 'p', 'a', 'b']);
    for (const id of ['f1', 'fc']) {
      expect(result.edges.some((edge) => edge.source === id || edge.target === id)).toBe(false);
    }
  });

  it('accepts a deep-frozen map and nodeSize and leaves them unchanged', () => {
    const map = sampleMap();
    const nodeSize = sizesOf([
      ['p', { width: 150, height: 120 }],
      ['a', { width: 90, height: Number.NaN }],
    ]);
    deepFreeze(map);
    Object.freeze(nodeSize);
    nodeSize.forEach((size) => Object.freeze(size));
    const mapBefore = structuredClone(map);
    const sizesBefore = structuredClone(nodeSize);

    const result = layout(map, { nodeSize });

    expect(map).toStrictEqual(mapBefore);
    expect(nodeSize).toStrictEqual(sizesBefore);
    expect(result.positions.size).toBe(4);
  });
});

describe('layoutForest — sizes and gap', () => {
  // Bite (iv). A chain puts one node per depth, so each column x is the running sum of the
  // sizes actually used plus the gap, and each y aligns the centres with the root's.
  it('returns valid measurements as given and the estimate for missing or invalid ones', () => {
    const chain = ['r', 'a', 'b', 'c', 'd', 'e'].reduceRight(
      (child, id) => node(id, [child], { text: `title ${id}` }),
      node('f', [], { text: 'title f' }),
    );
    const nodeSize = sizesOf([
      ['r', { width: 200, height: 50 }],
      ['b', { width: Number.NaN, height: 40 }],
      ['c', { width: 120, height: 0 }],
      ['d', { width: -5, height: 40 }],
      ['e', { width: 80, height: Number.POSITIVE_INFINITY }],
      ['f', { width: 90, height: 24 }],
    ]);
    const result = layout(mapOf(chain), { nodeSize });

    const estimate = estimateNodeSize('title a');
    expect(estimate).toStrictEqual({ width: 24 + 7 * 8, height: 32 });
    const expected: [NodeId, NodeSize][] = [
      ['r', { width: 200, height: 50 }],
      ['a', estimate],
      ['b', estimate],
      ['c', estimate],
      ['d', estimate],
      ['e', estimate],
      ['f', { width: 90, height: 24 }],
    ];
    expect([...result.sizes.entries()]).toStrictEqual(expected);
    expect([...result.sizes.keys()]).toStrictEqual([...result.positions.keys()]);

    let x = 0;
    for (const [id, size] of expected) {
      expect(result.positions.get(id)).toStrictEqual({ x, y: (50 - size.height) / 2 });
      x += size.width + DEFAULT_GAP;
    }
  });

  it('falls back to DEFAULT_GAP for a NaN, infinite or negative gap and honours 0', () => {
    const map = mapOf(node('r', [node('a'), node('b')]));
    const rootWidth = estimateNodeSize('R').width;
    expect(DEFAULT_GAP).toBe(32);

    const fallback = layout(map);
    expect(fallback.positions.get('a')?.x).toBe(rootWidth + 32);
    for (const gap of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(layout(map, { gap })).toStrictEqual(fallback);
    }
    expect(layout(map, { gap: 32 })).toStrictEqual(fallback);

    const touching = layout(map, { gap: 0 });
    expect(touching.positions.get('a')).toStrictEqual({ x: rootWidth, y: -16 });
    expect(touching.positions.get('b')).toStrictEqual({ x: rootWidth, y: 16 });
    expectNoIntersections(touching);
  });

  it('leaves at least DEFAULT_GAP between two adjacent leaf siblings', () => {
    const map = mapOf(node('r', [node('a'), node('b')]));
    const result = layout(map);

    expect(expectRowGaps(map, result, DEFAULT_GAP)).toBe(1);
  });

  it('leaves at least the explicit gap between mixed-height siblings and same-depth cousins', () => {
    const map = mapOf(
      node('r', [node('p', [node('p1'), node('p2')]), node('q', [node('q1'), node('q2')])]),
    );
    const nodeSize = sizesOf([
      ['p1', { width: 60, height: 20 }],
      ['p2', { width: 60, height: 120 }],
      ['q1', { width: 60, height: 20 }],
    ]);
    const result = layout(map, { nodeSize, gap: 10 });

    // Pairs: p-q at depth 1; p1-p2, p2-q1 (cousins under different parents), q1-q2 at depth 2.
    expect(expectRowGaps(map, result, 10)).toBe(4);
    const p2 = boxOf(result, 'p2');
    expect(boxOf(result, 'q1').y - (p2.y + p2.height)).toBeGreaterThanOrEqual(10 - ROUNDING);
    expectGoverningInvariant(map, result);
  });
});

describe('estimateNodeSize', () => {
  it('gives empty text the minimum width and every title height 32', () => {
    expect(estimateNodeSize('')).toStrictEqual({ width: 48, height: 32 });
    expect(estimateNodeSize('ab')).toStrictEqual({ width: 48, height: 32 });
    expect(estimateNodeSize('Hello')).toStrictEqual({ width: 64, height: 32 });
  });

  it('makes a CJK title wider than a Latin title of the same length', () => {
    expect(estimateNodeSize('思维导图')).toStrictEqual({ width: 80, height: 32 });
    expect(estimateNodeSize('abcd')).toStrictEqual({ width: 56, height: 32 });
  });

  it('counts code points, not UTF-16 units, with no maximum', () => {
    expect(estimateNodeSize('😀😀😀😀').width).toBe(24 + 4 * 8);
    expect(estimateNodeSize('x'.repeat(200)).width).toBe(24 + 200 * 8);
  });

  it.each([
    [0x2e7f, 8],
    [0x2e80, 14],
    [0x9fff, 14],
    [0xa000, 8],
    [0xabff, 8],
    [0xac00, 14],
    [0xd7af, 14],
    [0xd7b0, 8],
    [0xf8ff, 8],
    [0xf900, 14],
    [0xfaff, 14],
    [0xfb00, 8],
    [0xfeff, 8],
    [0xff00, 14],
    [0xffef, 14],
    [0xfff0, 8],
  ])('charges code point %d at %i px', (codePoint, perCodePoint) => {
    const text = String.fromCodePoint(codePoint).repeat(10);
    expect(estimateNodeSize(text).width).toBe(24 + 10 * perCodePoint);
  });
});

// Deterministic generator for the property case: mulberry32 with a fixed seed (no Math.random).
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LATIN = ['idea', 'Reading notes', 'x', 'Brainstorm outline for Q3', 'plan', 'Chapter two'];
const CJK = ['想法', '读书笔记：第一章', '方案', '头脑风暴提纲与要点整理', '学', '结构'];
const HEIGHTS = [20, 32, 48, 120];
const COLLAPSED_ID = 'n.2.1';
const MAX_DEPTH = 5;

interface Generated {
  map: MindMap;
  nodeSize: Map<NodeId, NodeSize>;
}

function generatedForest(): Generated {
  const next = seeded(20261105);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const nodeSize = new Map<NodeId, NodeSize>();

  // Child 0 is a leaf and child 1 is bushy at depths 1 and 2 (leaf-then-bushy-sibling pattern).
  const childCount = (depth: number, index: number): number => {
    if (depth >= MAX_DEPTH) return 0;
    if (depth === 0) return 4;
    if (depth <= 2 && index === 0) return 0;
    if (depth <= 2 && index === 1) return 5;
    if (depth <= 2) return 2 + Math.floor(next() * 2);
    return Math.floor(next() * 3);
  };
  const grow = (id: NodeId, depth: number, index: number): MindNode => {
    const text = `${pick(next() < 0.5 ? LATIN : CJK)}${pick(['', ' ', '·二', ' more'])}`;
    const count = childCount(depth, index);
    const children = Array.from({ length: count }, (_, i) =>
      grow(`${id}.${String(i)}`, depth + 1, i),
    );
    if (next() < 0.85) {
      const extra = 10 + Math.floor(next() * 120);
      nodeSize.set(id, { width: estimateNodeSize(text).width + extra, height: pick(HEIGHTS) });
    }
    return node(id, children, { text, ...(id === COLLAPSED_ID ? { collapsed: true } : {}) });
  };

  return { map: mapOf(grow('n', 0, 0)), nodeSize };
}

describe('layoutForest — governing invariant on a generated forest', () => {
  it('satisfies the invariant for a generated tree with mixed sizes and a collapsed subtree', () => {
    const { map, nodeSize } = generatedForest();
    const all = preOrder(map.roots, false);
    const depthOf = (id: NodeId): number => id.split('.').length - 1;
    const texts = all.map((current) => current.text).join('');
    const collapsed = all.find((current) => current.id === COLLAPSED_ID);

    expect(all.length).toBeGreaterThanOrEqual(60);
    expect(Math.max(...all.map((current) => depthOf(current.id)))).toBeGreaterThanOrEqual(4);
    expect(texts).toMatch(/[一-鿿]/);
    expect(texts).toMatch(/[A-Za-z]/);
    const heights = new Set([...nodeSize.values()].map((size) => size.height));
    expect(heights.has(20) && heights.has(120)).toBe(true);
    for (const current of all) {
      const size = nodeSize.get(current.id);
      if (size !== undefined) {
        expect(size.width).toBeGreaterThan(estimateNodeSize(current.text).width);
      }
    }
    expect(collapsed?.children.length).toBeGreaterThan(0);

    const result = layout(map, { nodeSize });
    expectGoverningInvariant(map, result);
    expect(expectRowGaps(map, result, DEFAULT_GAP)).toBeGreaterThan(0);
    expect(result.edges).toHaveLength(result.positions.size - 1);
    expect(layout(map, { nodeSize })).toStrictEqual(result);
  });
});
