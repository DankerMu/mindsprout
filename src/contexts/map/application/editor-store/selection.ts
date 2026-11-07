import type { MindMap, MindNode, NodeId } from '../../domain/types';

// Pure selection helpers for the editor store (design D5, "Fixture — issue #35"). "Visible" means
// no ancestor is collapsed: a collapsed node is itself visible, its descendants are not. Every
// list is in tree pre-order across roots (roots[0] first, then the floating roots in order).

export interface Editing {
  readonly id: NodeId;
  // true while the node is being named inside the creation group (design D3); false for a rename.
  readonly created: boolean;
}

export interface SelectionSlice {
  // Selection order = click order; the last clicked node is normally the primary.
  readonly selectedIds: readonly NodeId[];
  readonly primaryId: NodeId | null;
  readonly editing: Editing | null;
  readonly menuTargetId: NodeId | null;
}

export function visibleIds(map: MindMap): NodeId[] {
  const ids: NodeId[] = [];
  const walk = (nodes: readonly MindNode[]): void => {
    for (const current of nodes) {
      ids.push(current.id);
      if (current.collapsed !== true) walk(current.children);
    }
  };
  walk(map.roots);
  return ids;
}

// Selected ids that have no selected ancestor (design D5 normalisation), in tree pre-order. A
// selected node's subtree is skipped, so its descendants never appear; unknown ids drop out.
export function topmost(map: MindMap, ids: readonly NodeId[]): NodeId[] {
  const selected = new Set(ids);
  const result: NodeId[] = [];
  const walk = (nodes: readonly MindNode[]): void => {
    for (const current of nodes) {
      if (selected.has(current.id)) result.push(current.id);
      else walk(current.children);
    }
  };
  walk(map.roots);
  return result;
}

// Finds a node anywhere in the forest, hidden or not.
export function findNode(map: MindMap, id: NodeId): MindNode | undefined {
  const pending: MindNode[] = [...map.roots];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    if (current.id === id) return current;
    pending.push(...current.children);
  }
  return undefined;
}

export function parentOf(nodes: readonly MindNode[], id: NodeId): MindNode | undefined {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === id)) return node;
    const parent = parentOf(node.children, id);
    if (parent !== undefined) return parent;
  }
  return undefined;
}

// Re-establishes the store invariant after a map change: the selection keeps only ids that exist
// and are visible (order kept), the primary falls back to the last remaining selected id (or
// null), and editing / menu target are cleared when their node no longer exists.
export function prune(map: MindMap, slice: SelectionSlice): SelectionSlice {
  const visible = new Set(visibleIds(map));
  const selectedIds = slice.selectedIds.filter((id) => visible.has(id));
  const { primaryId, editing, menuTargetId } = slice;
  const keepPrimary = primaryId !== null && selectedIds.includes(primaryId);
  return {
    selectedIds,
    primaryId: keepPrimary ? primaryId : (selectedIds.at(-1) ?? null),
    editing: editing !== null && findNode(map, editing.id) !== undefined ? editing : null,
    menuTargetId:
      menuTargetId !== null && findNode(map, menuTargetId) !== undefined ? menuTargetId : null,
  };
}
