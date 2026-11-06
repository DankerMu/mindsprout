import { hierarchy, tree, type HierarchyNode } from 'd3-hierarchy';
import type { MindMap, MindNode, NodeId, Position } from '../../domain/types';

// Left-to-right tree layout (design D4, "Fixture — issue #8"). Pure: no mutation of the map or
// options, no clock, no randomness — the same inputs give toStrictEqual outputs.
//
// Coordinate convention (shared with 3.2, 6.1 and 8.x):
// - a position is the top-left corner of the node's box in canvas pixels (React Flow's position);
// - the primary root's top-left is exactly (0, 0); columns and rows are computed per tree from
//   that tree's visible nodes only, so an edit in one tree never moves another;
// - columns: a node at depth d has x = Σ_{k<d} (widest visible node at depth k + gap), so nodes
//   at different depths never overlap horizontally;
// - rows: d3 tree() with nodeSize([1, 1]) and separation (height(a) + height(b)) / 2 + gap gives
//   each vertical centre in pixels; adjacent same-depth nodes are at least that far apart, so
//   same-depth boxes never overlap, and a parent is centred on its first and last child.
//
// Scope in 3.1: only roots[0] is laid out; floating roots get no positions and no edges (3.2).
// A collapsed node is positioned, its descendants are not.

export interface NodeSize {
  width: number;
  height: number;
}

export interface LayoutOptions {
  // Only LR exists in M1 (design Non-Goals); the parameter keeps the call sites stable.
  direction: 'LR';
  // Measured sizes from the rendered nodes (task 6.1); invalid or missing entries use the estimate.
  nodeSize?: ReadonlyMap<NodeId, NodeSize>;
  gap?: number;
}

export interface ForestLayout {
  positions: Map<NodeId, Position>;
  // The size actually used for every positioned node: same keys, same order as positions.
  sizes: Map<NodeId, NodeSize>;
  edges: { source: NodeId; target: NodeId }[];
}

// Used when options.gap is absent, not finite or negative; 0 lets boxes touch, never overlap.
export const DEFAULT_GAP = 32;

const ESTIMATE_HEIGHT = 32;
const ESTIMATE_MIN_WIDTH = 48;
const ESTIMATE_PADDING = 24;
const WIDE_CODE_POINT_WIDTH = 14;
const NARROW_CODE_POINT_WIDTH = 8;

// CJK and full-width ranges charged as wide. Anything else (astral CJK, emoji included) counts as
// narrow; measurement corrects it.
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x2e80, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
];

function codePointWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  const wide = WIDE_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
  return wide ? WIDE_CODE_POINT_WIDTH : NARROW_CODE_POINT_WIDTH;
}

// First-paint estimate before a node is measured. Titles are single-line (D9), so no maximum.
export function estimateNodeSize(text: string): NodeSize {
  const content = Array.from(text).reduce((sum, char) => sum + codePointWidth(char), 0);
  return {
    width: Math.max(ESTIMATE_MIN_WIDTH, ESTIMATE_PADDING + content),
    height: ESTIMATE_HEIGHT,
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function sizeOf(current: MindNode, nodeSize: LayoutOptions['nodeSize']): NodeSize {
  const measured = nodeSize?.get(current.id);
  if (
    measured !== undefined &&
    isPositiveFinite(measured.width) &&
    isPositiveFinite(measured.height)
  ) {
    return { width: measured.width, height: measured.height };
  }
  return estimateNodeSize(current.text);
}

function gapOf(gap: number | undefined): number {
  return gap !== undefined && Number.isFinite(gap) && gap >= 0 ? gap : DEFAULT_GAP;
}

// The visible tree with each node's size resolved once; collapsed nodes contribute no children.
interface SizedNode {
  id: NodeId;
  size: NodeSize;
  children: SizedNode[];
}

function sizedTree(current: MindNode, nodeSize: LayoutOptions['nodeSize']): SizedNode {
  const visible = current.collapsed === true ? [] : current.children;
  return {
    id: current.id,
    size: sizeOf(current, nodeSize),
    children: visible.map((child) => sizedTree(child, nodeSize)),
  };
}

function widestPerDepth(root: HierarchyNode<SizedNode>): number[] {
  const widest: number[] = [];
  root.each(({ depth, data }) => {
    widest[depth] = Math.max(widest[depth] ?? 0, data.size.width);
  });
  return widest;
}

function heightOf({ data }: HierarchyNode<SizedNode>): number {
  return data.size.height;
}

function layoutTree(primary: MindNode, options: LayoutOptions, out: ForestLayout): void {
  const gap = gapOf(options.gap);
  const root = hierarchy(sizedTree(primary, options.nodeSize));
  const widest = widestPerDepth(root);
  const rows = tree<SizedNode>()
    .nodeSize([1, 1])
    .separation((a, b) => (heightOf(a) + heightOf(b)) / 2 + gap)(root);
  const rootTop = rows.x - heightOf(rows) / 2;
  rows.eachBefore((current) => {
    const { id, size } = current.data;
    const x = widest.slice(0, current.depth).reduce((sum, width) => sum + width + gap, 0);
    out.positions.set(id, { x, y: current.x - size.height / 2 - rootTop });
    out.sizes.set(id, size);
    if (current.parent !== null) out.edges.push({ source: current.parent.data.id, target: id });
  });
}

export function layoutForest(map: MindMap, options: LayoutOptions): ForestLayout {
  const out: ForestLayout = { positions: new Map(), sizes: new Map(), edges: [] };
  for (const primary of map.roots.slice(0, 1)) layoutTree(primary, options, out);
  return out;
}
