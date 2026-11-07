import type { TreeOp } from '../domain/tree-op';
import type { MindMap, NodeId, Position } from '../domain/types';
import { findNode, topmost, visibleIds } from './editor-store/selection';
import type { ForestLayout } from './layout/layout-forest';

type DropRefusal = 'primary-root' | 'self' | 'cycle' | 'stale';
type DropPlan = { refusal: DropRefusal } | { ops: readonly TreeOp[] };

export interface DragSnapshot {
  selection: readonly NodeId[];
  members: readonly { id: NodeId; position: Position }[];
  positions: ReadonlyMap<NodeId, Position>;
  anchor: Position;
}

export function captureNodeDrag(
  map: MindMap,
  layout: ForestLayout,
  selection: readonly NodeId[],
  grabbed: NodeId,
): DragSnapshot | undefined {
  const selected = selection.includes(grabbed) ? [...selection] : [grabbed];
  const visible = new Set(visibleIds(map));
  if (selected.some((id) => !visible.has(id))) return undefined;
  const members: { id: NodeId; position: Position }[] = [];
  const positions = new Map<NodeId, Position>();
  for (const id of topmost(map, selected)) {
    const source = findNode(map, id);
    if (source === undefined) return undefined;
    for (const descendant of visibleIds({ ...map, roots: [source] })) {
      const position = layout.positions.get(descendant);
      if (position === undefined || !layout.sizes.has(descendant)) return undefined;
      const original = { ...position };
      positions.set(descendant, original);
      if (descendant === id) members.push({ id, position: original });
    }
  }
  const anchor = positions.get(grabbed);
  if (anchor === undefined) return undefined;
  members.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  return { selection: selected, members, positions, anchor };
}

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

export function planNodeDrop(
  map: MindMap,
  layout: ForestLayout,
  selection: readonly NodeId[],
  grabbed: NodeId,
  pointer: Position,
  position: Position,
): DropPlan {
  const drag = captureNodeDrag(map, layout, selection, grabbed);
  if (drag === undefined) return { refusal: 'stale' };
  // Source subtree boxes take precedence even when another tree overlaps them.
  const target =
    [...drag.positions.keys()].find((id) => contains(layout, id, pointer)) ??
    hitDropTarget(layout, pointer);
  for (const { id } of drag.members) {
    const refusal = dropRefusal(map, id, target);
    if (refusal !== undefined) return { refusal };
  }
  const ops = drag.members.map(({ id, position: original }): TreeOp => {
    if (target !== undefined) return { op: 'move_node', id, newParentId: target };
    const destination = {
      x: position.x + original.x - drag.anchor.x,
      y: position.y + original.y - drag.anchor.y,
    };
    return map.roots.some((root) => root.id === id)
      ? { op: 'set_root_position', id, position: destination }
      : { op: 'move_node', id, newParentId: null, position: destination };
  });
  return { ops };
}
