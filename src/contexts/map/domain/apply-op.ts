import { TreeOpError } from './errors';
import { parseTreeOp, type TreeOp } from './tree-op';
import type { ColorToken, MindMap, MindNode, NewNode, NodeId } from './types';

// The only writer of tree state (decision 0003, design D2). Pure: the input map is never mutated
// (untouched subtrees are shared), map metadata (title, createdAt, updatedAt) is never read or
// written, and `inverse` is the ordered op list that restores the input map exactly.
// Validation order: schema (invalid-op) → unknown-node → primary-root-protected → invalid-target.

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
    case 'set_root_position':
    case 'replace_children':
      throw new TreeOpError('invalid-op', `${parsed.op} is not supported yet`);
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
  const count = map.roots.length;
  const index = op.index ?? count;
  if (index < 1 || index > count) {
    throw new TreeOpError(
      'invalid-target',
      `add_root index ${String(index)} is outside 1..${String(count)} (roots[0] is the primary root)`,
    );
  }
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
  if (target.parent === null && target.index === 0) {
    throw new TreeOpError(
      'primary-root-protected',
      `delete_node cannot remove the primary root ${op.id}`,
    );
  }
  const inverse = restoreOp(target);
  const roots = editList(map.roots, target.parentPath, (siblings) =>
    siblings.filter((_, i) => i !== target.index),
  );
  return { map: { ...map, roots }, inverse: [inverse] };
}

// Inverse of delete_node: re-insert the whole subtree at the same parent and index, or as a
// floating root at the same roots index and position.
function restoreOp({ node, parent, index }: Located): TreeOp {
  if (parent !== null) {
    return { op: 'add_children', parentId: parent.id, children: [toNewNode(node)], index };
  }
  if (node.position === undefined) {
    throw new TreeOpError(
      'invalid-target',
      `floating root ${node.id} has no position (corrupt map)`,
    );
  }
  const position = { x: node.position.x, y: node.position.y };
  return { op: 'add_root', node: toNewNode(node), position, index };
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

// Rejects any payload id already in the map or repeated inside the payload, at any nesting.
function assertFreshIds(map: MindMap, payload: readonly NewNode[]): void {
  const taken = new Set<NodeId>();
  collectIds(map.roots, taken);
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

function insertAt(
  list: readonly MindNode[],
  index: number,
  items: readonly MindNode[],
): MindNode[] {
  return [...list.slice(0, index), ...items, ...list.slice(index)];
}
