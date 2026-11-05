import { describe, expect, it } from 'vitest';
import {
  applyAndUndo,
  entriesOf,
  UPDATED_AT,
  type Entry,
} from '../../../../tests/support/map-domain';
import { applyOp } from './apply-op';
import { createMindMap } from './create-mind-map';
import type { TreeOp } from './tree-op';
import type { ColorToken, MindMap, MindNode, NewNode, NodeId } from './types';

// Spec "Applying then applying the inverse restores the map" over all seven ops (design "Fixture —
// issue #5"): seeded PRNG, no dependency (not fast-check). The shared apply helper asserts the
// frozen input, untouched metadata and D1 after the op and after every inverse step.

const COLORS: readonly ColorToken[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

// mulberry32: tiny deterministic PRNG so every case is reproducible from its seed.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRandom(seed: number) {
  const next = mulberry32(seed);
  let counter = 0;
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  return {
    int,
    chance: (): boolean => next() < 0.5,
    pick: <T>(items: readonly T[]): T => {
      const item = items[int(items.length)];
      if (item === undefined) throw new Error('pick from an empty list');
      return item;
    },
    freshId: (): NodeId => `n${String((counter += 1))}`,
  };
}

type Random = ReturnType<typeof createRandom>;

// `reusable` (replace_children only) holds ids that may be drawn again instead of a fresh one; each
// drawn id leaves the pool, so a payload never repeats an id.
function drawId(random: Random, reusable: NodeId[]): NodeId {
  const reused =
    reusable.length > 0 && random.chance() ? reusable.splice(random.int(reusable.length), 1) : [];
  return reused[0] ?? random.freshId();
}

function randomNewNode(random: Random, depth: number, reusable: NodeId[] = []): NewNode {
  const id = drawId(random, reusable);
  const children =
    depth > 0 && random.chance() ? randomNewNodes(random, depth - 1, reusable) : undefined;
  return {
    id,
    text: `text ${id}`,
    ...(random.chance() ? { note: `note ${id}` } : {}),
    ...(random.chance() ? { color: random.pick(COLORS) } : {}),
    ...(random.chance() ? { collapsed: true } : {}),
    ...(children === undefined ? {} : { children }),
  };
}

function randomNewNodes(random: Random, depth: number, reusable: NodeId[] = []): NewNode[] {
  return Array.from({ length: 1 + random.int(2) }, () => randomNewNode(random, depth, reusable));
}

function randomAddChildren(random: Random, map: MindMap, withIndex: boolean): TreeOp {
  const parent = random.pick(entriesOf(map)).node;
  const index = random.int(parent.children.length + 1);
  return {
    op: 'add_children',
    parentId: parent.id,
    children: randomNewNodes(random, 2),
    ...(withIndex ? { index } : {}),
  };
}

function randomPosition(random: Random): { x: number; y: number } {
  return { x: random.int(1000) - 500, y: (random.int(2000) - 1000) / 4 };
}

function randomAddRoot(random: Random, map: MindMap, withIndex: boolean): TreeOp {
  const index = 1 + random.int(map.roots.length);
  const position = randomPosition(random);
  return {
    op: 'add_root',
    node: randomNewNode(random, 2),
    position,
    ...(withIndex ? { index } : {}),
  };
}

function randomUpdateFields(random: Random) {
  return {
    ...(random.chance() ? { text: `renamed ${random.freshId()}` } : {}),
    ...(random.chance() ? { note: random.chance() ? `note ${random.freshId()}` : null } : {}),
    ...(random.chance() ? { color: random.chance() ? random.pick(COLORS) : null } : {}),
    ...(random.chance() ? { collapsed: random.chance() } : {}),
  };
}

function randomUpdate(random: Random, map: MindMap): TreeOp {
  const target = random.pick(entriesOf(map)).node;
  const fields = randomUpdateFields(random);
  return {
    op: 'update_node',
    id: target.id,
    ...(Object.keys(fields).length > 0 ? fields : { collapsed: true }),
  };
}

function randomDelete(random: Random, map: MindMap): TreeOp {
  const candidates = entriesOf(map).filter((entry) => entry.parentId !== null || entry.index > 0);
  return { op: 'delete_node', id: random.pick(candidates).node.id };
}

function isPrimary(entry: Entry): boolean {
  return entry.parentId === null && entry.index === 0;
}

function isFloating(entry: Entry): boolean {
  return entry.parentId === null && entry.index > 0;
}

function subtreeIds(root: MindNode): Set<NodeId> {
  const ids = new Set<NodeId>([root.id]);
  root.children.forEach((child) => {
    subtreeIds(child).forEach((id) => ids.add(id));
  });
  return ids;
}

type MoveVariant = 'reparent' | 'reorder' | 'attach' | 'detach';

interface MoveCandidate {
  entry: Entry;
  destination: MindNode | null;
}

// Every legal (node, destination) pair, grouped by variant; null destination = detach.
function moveCandidates(map: MindMap): Record<MoveVariant, MoveCandidate[]> {
  const entries = entriesOf(map);
  const groups: Record<MoveVariant, MoveCandidate[]> = {
    reparent: [],
    reorder: [],
    attach: [],
    detach: [],
  };
  for (const entry of entries.filter((candidate) => !isPrimary(candidate))) {
    const inside = subtreeIds(entry.node);
    for (const { node: destination } of entries.filter((d) => !inside.has(d.node.id))) {
      groups[moveVariant(entry, destination.id)].push({ entry, destination });
    }
    if (!isFloating(entry)) groups.detach.push({ entry, destination: null });
  }
  return groups;
}

function moveVariant(entry: Entry, newParentId: NodeId | null): MoveVariant {
  if (newParentId === null) return 'detach';
  if (entry.parentId === null) return 'attach';
  return newParentId === entry.parentId ? 'reorder' : 'reparent';
}

// Explicit final indices, drawn over the destination list counted without the moved node.
function randomMove(random: Random, map: MindMap): TreeOp {
  const groups = moveCandidates(map);
  const variants = (Object.keys(groups) as MoveVariant[]).filter((v) => groups[v].length > 0);
  const variant = random.pick(variants);
  const { entry, destination } = random.pick(groups[variant]);
  if (destination === null) {
    const index = 1 + random.int(map.roots.length);
    return {
      op: 'move_node',
      id: entry.node.id,
      newParentId: null,
      position: randomPosition(random),
      index,
    };
  }
  const slots = destination.children.length + (variant === 'reorder' ? 0 : 1);
  return {
    op: 'move_node',
    id: entry.node.id,
    newParentId: destination.id,
    index: random.int(slots),
  };
}

function randomSetRootPosition(random: Random, map: MindMap): TreeOp {
  const target = random.pick(entriesOf(map).filter(isFloating)).node;
  return { op: 'set_root_position', id: target.id, position: randomPosition(random) };
}

// Targets any node; the payload mixes ids reused from P's descendants (any depth, re-nested) with
// fresh ids, and is sometimes [].
function randomReplace(random: Random, map: MindMap): TreeOp {
  const parent = random.pick(entriesOf(map)).node;
  const reusable = [...subtreeIds(parent)].filter((id) => id !== parent.id);
  const children = random.int(4) === 0 ? [] : randomNewNodes(random, 2, reusable);
  return { op: 'replace_children', parentId: parent.id, children };
}

// Canonical map: createMindMap + one floating root (set_root_position and attach always have a
// target) + random add_children / add_root with explicit in-range indices.
function randomMap(random: Random): MindMap {
  let map = createMindMap({
    id: 'm-prop',
    rootId: 'root',
    title: '性质',
    rootText: '根',
    now: () => new Date(UPDATED_AT),
  });
  map = applyOp(map, randomAddRoot(random, map, true)).map;
  const steps = 1 + random.int(8);
  for (let step = 0; step < steps; step += 1) {
    const op =
      random.int(4) === 0 ? randomAddRoot(random, map, true) : randomAddChildren(random, map, true);
    map = applyOp(map, op).map;
  }
  return map;
}

// Drawn ops sometimes omit `index` so the default-append path is exercised too.
function drawAddChildren(random: Random, map: MindMap): TreeOp {
  return randomAddChildren(random, map, random.chance());
}

function drawAddRoot(random: Random, map: MindMap): TreeOp {
  return randomAddRoot(random, map, random.chance());
}

const drawOp = {
  add_children: drawAddChildren,
  add_root: drawAddRoot,
  update_node: randomUpdate,
  delete_node: randomDelete,
  move_node: randomMove,
  set_root_position: randomSetRootPosition,
  replace_children: randomReplace,
} satisfies Record<string, (random: Random, map: MindMap) => TreeOp>;

type OpKind = keyof typeof drawOp;
const OP_KINDS = Object.keys(drawOp) as OpKind[];

function caseFor(seed: number, kind: OpKind): { map: MindMap; op: TreeOp } {
  const random = createRandom(seed);
  const map = randomMap(random);
  return { map, op: drawOp[kind](random, map) };
}

function checkRoundTrip(seed: number, kind: OpKind): void {
  const { map, op } = caseFor(seed, kind);
  try {
    applyAndUndo(map, op);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`round-trip failed for seed ${String(seed)} (${kind}): ${detail}`, {
      cause: error,
    });
  }
}

function entryOf(map: MindMap, id: NodeId): Entry {
  const found = entriesOf(map).find((entry) => entry.node.id === id);
  if (found === undefined) throw new Error(`node ${id} is not in the generated map`);
  return found;
}

interface PayloadEntry {
  id: NodeId;
  depth: number;
}

function payloadEntries(nodes: readonly NewNode[], depth = 1): PayloadEntry[] {
  return nodes.flatMap((child) => [
    { id: child.id, depth },
    ...payloadEntries(child.children ?? [], depth + 1),
  ]);
}

describe('applyOp — Applying then applying the inverse restores the map (seeded property)', () => {
  it('covers all seven op kinds', () => {
    expect(OP_KINDS).toHaveLength(7);
  });

  it.each(OP_KINDS)('%s over 200 seeded canonical maps', (kind) => {
    SEEDS.forEach((seed) => {
      checkRoundTrip(seed, kind);
    });
  });

  it('the generator reaches nested, non-last, floating-root and primary targets and null clears', () => {
    const deletes = SEEDS.map((seed) => {
      const { map, op } = caseFor(seed, 'delete_node');
      return entriesOf(map).find((entry) => op.op === 'delete_node' && entry.node.id === op.id);
    });
    const updates = SEEDS.map((seed) => caseFor(seed, 'update_node').op);

    expect(deletes.some((entry) => entry !== undefined && entry.depth >= 2)).toBe(true);
    expect(deletes.some((entry) => entry?.parentId === null)).toBe(true);
    expect(deletes.some((entry) => entry !== undefined && entry.node.children.length > 0)).toBe(
      true,
    );
    expect(
      deletes.some((entry) => entry !== undefined && entry.index < entry.siblingCount - 1),
    ).toBe(true);
    expect(updates).toContainEqual(expect.objectContaining({ id: 'root' }));
    expect(updates).toContainEqual(expect.objectContaining({ note: null }));
    expect(updates).toContainEqual(expect.objectContaining({ color: null }));
    expect(updates).toContainEqual(expect.objectContaining({ collapsed: false }));
  });

  it('the generator reaches every move_node variant with in-range final indices', () => {
    const moves = SEEDS.map((seed) => {
      const { map, op } = caseFor(seed, 'move_node');
      if (op.op !== 'move_node') throw new Error('expected a move_node');
      const entry = entryOf(map, op.id);
      return { map, op, entry, variant: moveVariant(entry, op.newParentId) };
    });
    const hit = (variant: MoveVariant) => moves.filter((move) => move.variant === variant);

    expect(hit('reparent').some(({ entry }) => entry.depth >= 2)).toBe(true);
    expect(hit('reorder').some(({ op, entry }) => op.index !== entry.index)).toBe(true);
    expect(hit('attach').some(({ op }) => op.newParentId !== 'root')).toBe(true);
    expect(hit('detach').some(({ op, map }) => (op.index ?? 0) < map.roots.length)).toBe(true);
    expect(moves.every(({ op }) => op.index !== undefined)).toBe(true);
  });

  it('the generator reaches every floating root and replace target kind, reuse and []', () => {
    const positions = SEEDS.map((seed) => {
      const { map, op } = caseFor(seed, 'set_root_position');
      return op.op === 'set_root_position' ? entryOf(map, op.id) : undefined;
    });
    const replaces = SEEDS.map((seed) => {
      const { map, op } = caseFor(seed, 'replace_children');
      if (op.op !== 'replace_children') throw new Error('expected a replace_children');
      const target = entryOf(map, op.parentId);
      const old = new Map(entriesOf(map).map((entry) => [entry.node.id, entry.depth]));
      const reused = payloadEntries(op.children).filter(({ id }) => old.has(id));
      return { target, op, reused, old };
    });

    expect(positions.some((entry) => entry?.index === 1)).toBe(true);
    expect(positions.some((entry) => entry !== undefined && entry.index >= 2)).toBe(true);
    expect(replaces.some(({ target }) => isPrimary(target))).toBe(true);
    expect(replaces.some(({ target }) => isFloating(target))).toBe(true);
    expect(replaces.some(({ target }) => target.depth >= 1)).toBe(true);
    expect(replaces.some(({ op }) => op.children.length === 0)).toBe(true);
    expect(
      replaces.some(
        ({ reused, op }) => reused.length < payloadEntries(op.children).length && reused.length > 0,
      ),
    ).toBe(true);
    expect(
      replaces.some(({ reused, old, target }) =>
        reused.some(({ id, depth }) => old.get(id) !== target.depth + depth),
      ),
    ).toBe(true);
  });
});
