import { TreeOpError } from './errors';
import { parseTreeOp, type TreeOp } from './tree-op';
import type { ColorToken, MindMap, MindNode, NewNode, NodeId, Position } from './types';

// The only writer of tree state (decision 0003, design D2). Pure: the input map is never mutated
// (untouched subtrees are shared), map metadata (title, createdAt, updatedAt) is never read or
// written, and `inverse` is the ordered op list that restores the input map exactly.
// Validation order: schema (invalid-op) → unknown-node → primary-root-protected → cycle →
// invalid-target. A `move_node` index is the node's final index in the destination list, counted
// without the moved node, so a same-parent move is a reorder.

type OpOf<K extends TreeOp['op']> = Extract<TreeOp, { op: K }>;

interface ApplyOpResult {
  map: MindMap;
  inverse: TreeOp[];
}

interface Located {
  node: MindNode;
  // null when the node is a root (primary or floating).
  parent: MindNode | null;
  // Child indices from `roots` down to the parent; [] when the node is a root.
  parentPath: readonly number[];
  // Position within the parent's children, or within `roots`.
  index: number;
}

export function applyOp(map: MindMap, op: TreeOp): ApplyOpResult {
  // Re-validated here: callers may hand over cast or model-produced objects (spec "Ops are
  // validated before they are applied"), and a malformed op must fail before any traversal.
  const parsed = parseTreeOp(op);
  switch (parsed.op) {
    case 'add_children':
      return addChildren(map, parsed);
    case 'add_root':
      return addRoot(map, parsed);
    case 'update_node':
      return updateNode(map, parsed);
    case 'delete_node':
      return deleteNode(map, parsed);
    case 'move_node':
      return moveNode(map, parsed);
    case 'set_root_position':
      return setRootPosition(map, parsed);
    case 'replace_children':
      return replaceChildren(map, parsed);
  }
}

function addChildren(map: MindMap, op: OpOf<'add_children'>): ApplyOpResult {
  const parent = requireNode(map, op.parentId);
  const count = parent.node.children.length;
  const index = op.index ?? count;
  if (index > count) {
    throw new TreeOpError(
      'invalid-target',
      `add_children index ${String(index)} is beyond the ${String(count)} children of ${op.parentId}`,
    );
  }
  assertFreshIds(map, op.children);
  const roots = editList(map.roots, [...parent.parentPath, parent.index], (children) =>
    insertAt(children, index, op.children.map(toMindNode)),
  );
  const inverse = op.children.map((child): TreeOp => ({ op: 'delete_node', id: child.id }));
  return { map: { ...map, roots }, inverse: inverse.reverse() };
}

function addRoot(map: MindMap, op: OpOf<'add_root'>): ApplyOpResult {
  const index = assertRootsIndex(map, op.index, op.op);
  assertFreshIds(map, [op.node]);
  const root: MindNode = { ...toMindNode(op.node), position: op.position };
  return {
    map: { ...map, roots: insertAt(map.roots, index, [root]) },
    inverse: [{ op: 'delete_node', id: op.node.id }],
  };
}

function updateNode(map: MindMap, op: OpOf<'update_node'>): ApplyOpResult {
  const target = requireNode(map, op.id);
  const next = updatedNode(target.node, op);
  const roots = editList(map.roots, target.parentPath, (siblings) =>
    siblings.map((sibling, i) => (i === target.index ? next : sibling)),
  );
  return { map: { ...map, roots }, inverse: [updateInverse(target.node, op)] };
}

function deleteNode(map: MindMap, op: OpOf<'delete_node'>): ApplyOpResult {
  const target = requireNode(map, op.id);
  assertNotPrimaryRoot(target, op.op);
  const inverse = restoreOp(target);
  return { map: { ...map, roots: removeAt(map.roots, target) }, inverse: [inverse] };
}

// Inverse of delete_node: re-insert the whole subtree at the same parent and index, or as a
// floating root at the same roots index and position.
function restoreOp({ node, parent, index }: Located): TreeOp {
  if (parent !== null) {
    return { op: 'add_children', parentId: parent.id, children: [toNewNode(node)], index };
  }
  return { op: 'add_root', node: toNewNode(node), position: rootPosition(node), index };
}

function moveNode(map: MindMap, op: OpOf<'move_node'>): ApplyOpResult {
  const target = requireNode(map, op.id);
  if (op.newParentId === null) {
    assertNotPrimaryRoot(target, op.op);
    return detach(map, target, op.position, op.index);
  }
  const destination = requireNode(map, op.newParentId);
  assertNotPrimaryRoot(target, op.op);
  if (locate([target.node], destination.node.id, null, []) !== undefined) {
    throw new TreeOpError(
      'cycle',
      `move_node cannot place ${op.id} under ${op.newParentId}, which is the node or its descendant`,
    );
  }
  return reparent(map, target, op.newParentId, op.index);
}

// Reparents a tree node or attaches a floating root (dropping its position) under newParentId.
function reparent(
  map: MindMap,
  target: Located,
  newParentId: NodeId,
  requestedIndex: number | undefined,
): ApplyOpResult {
  const inverse: TreeOp =
    target.parent === null
      ? {
          op: 'move_node',
          id: target.node.id,
          newParentId: null,
          position: rootPosition(target.node),
          index: target.index,
        }
      : { op: 'move_node', id: target.node.id, newParentId: target.parent.id, index: target.index };
  const without = removeAt(map.roots, target);
  // Re-located after the removal: the moved node may have sat on the destination's spine, and the
  // final index is counted without it.
  const destination = requireNode({ ...map, roots: without }, newParentId);
  const count = destination.node.children.length;
  const index = requestedIndex ?? count;
  if (index > count) {
    throw new TreeOpError(
      'invalid-target',
      `move_node index ${String(index)} is beyond the ${String(count)} other children of ${newParentId}`,
    );
  }
  const moved = { ...target.node };
  delete moved.position;
  const roots = editList(without, [...destination.parentPath, destination.index], (children) =>
    insertAt(children, index, [moved]),
  );
  return { map: { ...map, roots }, inverse: [inverse] };
}

// Detaches a tree node with its subtree into a floating root at `position`.
function detach(
  map: MindMap,
  target: Located,
  position: Position,
  requestedIndex: number | undefined,
): ApplyOpResult {
  if (target.parent === null) {
    throw new TreeOpError(
      'invalid-target',
      `move_node cannot detach ${target.node.id}: it is already a floating root (use set_root_position)`,
    );
  }
  const index = assertRootsIndex(map, requestedIndex, 'move_node');
  const root: MindNode = { ...target.node, position: { x: position.x, y: position.y } };
  return {
    map: { ...map, roots: insertAt(removeAt(map.roots, target), index, [root]) },
    inverse: [
      { op: 'move_node', id: target.node.id, newParentId: target.parent.id, index: target.index },
    ],
  };
}

function setRootPosition(map: MindMap, op: OpOf<'set_root_position'>): ApplyOpResult {
  const target = requireNode(map, op.id);
  assertNotPrimaryRoot(target, op.op);
  if (target.parent !== null) {
    throw new TreeOpError(
      'invalid-target',
      `set_root_position applies to floating roots only; ${op.id} is a child node`,
    );
  }
  const inverse: TreeOp = { op: op.op, id: op.id, position: rootPosition(target.node) };
  const moved = { ...target.node, position: { x: op.position.x, y: op.position.y } };
  const roots = map.roots.map((root, i) => (i === target.index ? moved : root));
  return { map: { ...map, roots }, inverse: [inverse] };
}

// Swaps P's whole child list. Payload ids may reuse ids of P's current descendants (they are
// replaced); any other id in the map, P's own included, is taken.
function replaceChildren(map: MindMap, op: OpOf<'replace_children'>): ApplyOpResult {
  const parent = requireNode(map, op.parentId);
  assertFreshIds(map, op.children, parent.node.children);
  const roots = editList(map.roots, [...parent.parentPath, parent.index], () =>
    op.children.map(toMindNode),
  );
  const inverse: TreeOp = {
    op: op.op,
    parentId: op.parentId,
    children: parent.node.children.map(toNewNode),
  };
  return { map: { ...map, roots }, inverse: [inverse] };
}

function assertNotPrimaryRoot({ node, parent, index }: Located, opName: TreeOp['op']): void {
  if (parent === null && index === 0) {
    throw new TreeOpError(
      'primary-root-protected',
      `${opName} cannot target the primary root ${node.id}`,
    );
  }
}

// A copy of a floating root's position; a floating root without one is a corrupt map.
function rootPosition(node: MindNode): Position {
  if (node.position === undefined) {
    throw new TreeOpError(
      'invalid-target',
      `floating root ${node.id} has no position (corrupt map)`,
    );
  }
  return { x: node.position.x, y: node.position.y };
}

function updatedNode(node: MindNode, op: OpOf<'update_node'>): MindNode {
  const { note, color, collapsed, ...rest } = node;
  // Canonical collapsed: expanded is stored as no flag, never `collapsed: false`.
  const nextCollapsed = op.collapsed === undefined ? collapsed : op.collapsed || undefined;
  return {
    ...rest,
    ...(op.text === undefined ? {} : { text: op.text }),
    ...noteAndColor({ note: resolve(op.note, note), color: resolve(op.color, color) }),
    ...(nextCollapsed === undefined ? {} : { collapsed: nextCollapsed }),
  };
}

// Absent → keep the current value; null → clear; a value → set.
function resolve<T>(requested: T | null | undefined, current: T | undefined): T | undefined {
  return requested === undefined ? current : (requested ?? undefined);
}

// Carries exactly the fields the op carried, each with its previous value.
function updateInverse(node: MindNode, op: OpOf<'update_node'>): TreeOp {
  return {
    op: 'update_node',
    id: node.id,
    ...(op.text === undefined ? {} : { text: node.text }),
    ...(op.note === undefined ? {} : { note: node.note ?? null }),
    ...(op.color === undefined ? {} : { color: node.color ?? null }),
    ...(op.collapsed === undefined ? {} : { collapsed: node.collapsed ?? false }),
  };
}

// Absent stays absent: a key is never written with the value undefined (exactOptionalPropertyTypes).
function noteAndColor(fields: { note?: string | undefined; color?: ColorToken | undefined }): {
  note?: string;
  color?: ColorToken;
} {
  return {
    ...(fields.note === undefined ? {} : { note: fields.note }),
    ...(fields.color === undefined ? {} : { color: fields.color }),
  };
}

// NewNode → MindNode: children default to [], never a position, collapsed only when true.
function toMindNode(node: NewNode): MindNode {
  return {
    id: node.id,
    text: node.text,
    ...noteAndColor(node),
    ...(node.collapsed === true ? { collapsed: true } : {}),
    children: (node.children ?? []).map(toMindNode),
  };
}

// MindNode → NewNode: lossless except position, which creation payloads never carry.
function toNewNode(node: MindNode): NewNode {
  return {
    id: node.id,
    text: node.text,
    ...noteAndColor(node),
    ...(node.collapsed === undefined ? {} : { collapsed: node.collapsed }),
    children: node.children.map(toNewNode),
  };
}

// A floating-root slot: 1..roots.length, default append (roots[0] is the primary root).
function assertRootsIndex(
  map: MindMap,
  requested: number | undefined,
  opName: TreeOp['op'],
): number {
  const count = map.roots.length;
  const index = requested ?? count;
  if (index < 1 || index > count) {
    throw new TreeOpError(
      'invalid-target',
      `${opName} roots index ${String(index)} is outside 1..${String(count)} (roots[0] is the primary root)`,
    );
  }
  return index;
}

function requireNode(map: MindMap, id: NodeId): Located {
  const found = locate(map.roots, id, null, []);
  if (found === undefined) {
    throw new TreeOpError('unknown-node', `node ${id} is not in the map`);
  }
  return found;
}

function locate(
  nodes: readonly MindNode[],
  id: NodeId,
  parent: MindNode | null,
  parentPath: readonly number[],
): Located | undefined {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) return { node, parent, parentPath, index };
    const found = locate(node.children, id, node, [...parentPath, index]);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Rejects any payload id already in the map or repeated inside the payload, at any nesting. Ids in
// `released` (the subtrees the op replaces) are free to reuse.
function assertFreshIds(
  map: MindMap,
  payload: readonly NewNode[],
  released: readonly MindNode[] = [],
): void {
  const taken = new Set<NodeId>();
  collectIds(map.roots, taken);
  const freed = new Set<NodeId>();
  collectIds(released, freed);
  freed.forEach((id) => taken.delete(id));
  const claim = (nodes: readonly NewNode[]): void => {
    for (const node of nodes) {
      if (taken.has(node.id)) {
        throw new TreeOpError(
          'invalid-target',
          `node id ${node.id} is already in use (in the map or earlier in the payload)`,
        );
      }
      taken.add(node.id);
      claim(node.children ?? []);
    }
  };
  claim(payload);
}

function collectIds(nodes: readonly MindNode[], into: Set<NodeId>): void {
  for (const node of nodes) {
    into.add(node.id);
    collectIds(node.children, into);
  }
}

// Rebuilds only the spine from `roots` to the list at `path`; every other subtree is shared.
function editList(
  nodes: readonly MindNode[],
  path: readonly number[],
  edit: (list: readonly MindNode[]) => MindNode[],
): MindNode[] {
  const [head, ...rest] = path;
  if (head === undefined) return edit(nodes);
  return nodes.map((node, i) =>
    i === head ? { ...node, children: editList(node.children, rest, edit) } : node,
  );
}

function removeAt(roots: readonly MindNode[], { parentPath, index }: Located): MindNode[] {
  return editList(roots, parentPath, (siblings) => siblings.filter((_, i) => i !== index));
}

function insertAt(
  list: readonly MindNode[],
  index: number,
  items: readonly MindNode[],
): MindNode[] {
  return [...list.slice(0, index), ...items, ...list.slice(index)];
}
