import type { TreeOp } from '../domain/tree-op';
import type { MindMap, NodeId, Position } from '../domain/types';
import { findNode } from './editor-store/selection';
import type { ForestLayout } from './layout/layout-forest';

type DropRefusal = 'primary-root' | 'self' | 'cycle';
type DropPlan = { refusal: DropRefusal } | { op: TreeOp };

function contains(layout: ForestLayout, id: NodeId, point: Position): boolean {
  const position = layout.positions.get(id);
  const size = layout.sizes.get(id);
  if (position === undefined || size === undefined) return false;
  return (
    point.x >= position.x &&
    point.x < position.x + size.width &&
    point.y >= position.y &&
    point.y < position.y + size.height
  );
}

// Half-open boxes; the first visible box in layout order wins overlapping targets.
export function hitDropTarget(
  layout: ForestLayout,
  point: Position,
  excluded?: NodeId,
): NodeId | undefined {
  for (const id of layout.positions.keys()) {
    if (id !== excluded && contains(layout, id, point)) return id;
  }
  return undefined;
}

export function dropRefusal(
  map: MindMap,
  id: NodeId,
  target: NodeId | undefined,
): DropRefusal | undefined {
  if (map.roots[0]?.id === id) return 'primary-root';
  if (target === id) return 'self';
  const source = findNode(map, id);
  if (
    target !== undefined &&
    source !== undefined &&
    findNode({ ...map, roots: source.children }, target) !== undefined
  )
    return 'cycle';
  return undefined;
}

export function planSingleNodeDrop(
  map: MindMap,
  layout: ForestLayout,
  id: NodeId,
  pointer: Position,
  position: Position,
): DropPlan {
  // A source-box hit is a refusal even if another tree overlaps it.
  const target = contains(layout, id, pointer) ? id : hitDropTarget(layout, pointer, id);
  const refusal = dropRefusal(map, id, target);
  if (refusal !== undefined) return { refusal };
  if (target !== undefined) return { op: { op: 'move_node', id, newParentId: target } };
  if (map.roots.some((root) => root.id === id)) {
    return { op: { op: 'set_root_position', id, position } };
  }
  return { op: { op: 'move_node', id, newParentId: null, position } };
}
