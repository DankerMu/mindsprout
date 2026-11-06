import { hierarchy, tree, type HierarchyNode } from 'd3-hierarchy';
import type { MindMap, MindNode, NodeId, Position } from '../../domain/types';

// Left-to-right tree layout (design D4, "Fixture — issue #8"). Pure: no mutation of the map or
// options, no clock, no randomness — the same inputs give toStrictEqual outputs.
//
// Coordinate convention (shared with 3.2, 6.1 and 8.x):
// - a position is the top-left corner of the node's box in canvas pixels (React Flow's position);
// - the primary root's top-left is exactly (0, 0) and each floating root's top-left is exactly its
//   stored position: every tree is laid out by the same routine with its root at (0, 0), then
//   translated by its anchor; columns and rows are computed per tree from that tree's visible
//   nodes only, so an edit in one tree never moves another (trees may overlap each other);
// - columns: a node at depth d has x = Σ_{k<d} (widest visible node at depth k + gap), so nodes
//   at different depths never overlap horizontally;
// - rows: d3 tree() with nodeSize([1, 1]) and separation (height(a) + height(b)) / 2 + gap gives
//   each vertical centre in pixels; adjacent same-depth nodes are at least that far apart, so
//   same-depth boxes never overlap, and a parent is centred on its first and last child.
//
// Every root is laid out: positions, sizes and edges list the primary tree first, then each floating
// tree in roots order, each in pre-order; no edge joins two roots. A collapsed node is positioned,
// its descendants are not. A floating root without a finite position is a corrupt map and throws.

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

// The one acceptance test for a measured size: both sides positive and finite. Anything else (a
// 0×0 box from a hidden container, NaN, Infinity) falls back to the estimate.
export function isValidNodeSize(size: NodeSize): boolean {
  return isPositiveFinite(size.width) && isPositiveFinite(size.height);
}

function sizeOf(current: MindNode, nodeSize: LayoutOptions['nodeSize']): NodeSize {
  const measured = nodeSize?.get(current.id);
  if (measured !== undefined && isValidNodeSize(measured)) {
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

// One tree, root top-left at `anchor`: local coordinates (root at (0, 0)) plus the anchor.
function layoutTree(
  treeRoot: MindNode,
  anchor: Position,
  options: LayoutOptions,
  out: ForestLayout,
): void {
  const gap = gapOf(options.gap);
  const root = hierarchy(sizedTree(treeRoot, options.nodeSize));
  const widest = widestPerDepth(root);
  const rows = tree<SizedNode>()
    .nodeSize([1, 1])
    .separation((a, b) => (heightOf(a) + heightOf(b)) / 2 + gap)(root);
  const rootTop = rows.x - heightOf(rows) / 2;
  rows.eachBefore((current) => {
    const { id, size } = current.data;
    const x = widest.slice(0, current.depth).reduce((sum, width) => sum + width + gap, 0);
    const y = current.x - size.height / 2 - rootTop;
    out.positions.set(id, { x: x + anchor.x, y: y + anchor.y });
    out.sizes.set(id, size);
    if (current.parent !== null) out.edges.push({ source: current.parent.data.id, target: id });
  });
}

const ORIGIN: Position = { x: 0, y: 0 };

// A floating root's stored position, its top-left. No TreeOp produces a floating root without a
// finite one; a hand-edited persisted record can, and it is never laid out at an invented place.
function anchorOf(floating: MindNode): Position {
  const { position } = floating;
  if (position === undefined || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new Error(`layoutForest: floating root ${floating.id} has no finite position`);
  }
  return position;
}

export function layoutForest(map: MindMap, options: LayoutOptions): ForestLayout {
  const out: ForestLayout = { positions: new Map(), sizes: new Map(), edges: [] };
  for (const [index, treeRoot] of map.roots.entries()) {
    layoutTree(treeRoot, index === 0 ? ORIGIN : anchorOf(treeRoot), options, out);
  }
  return out;
}

export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// The union of every laid-out box (all trees), from positions plus the sizes the layout used;
// undefined when nothing is laid out. A position without a size breaks ForestLayout's contract.
export function contentBounds(layout: ForestLayout): ContentBounds | undefined {
  if (layout.positions.size === 0) return undefined;
  const bounds: ContentBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const [id, { x, y }] of layout.positions) {
    const size = layout.sizes.get(id);
    if (size === undefined) throw new Error(`contentBounds: node ${id} has a position but no size`);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x + size.width);
    bounds.maxY = Math.max(bounds.maxY, y + size.height);
  }
  return bounds;
}
