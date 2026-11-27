import { type NewNode, type NodeId, parseTreeOp, type TreeOp } from '../acl/map';
import { ProviderOutputError } from '../domain/errors';
import { type GenerationCaps, generateToolInputSchema } from '../domain/generate-tool';

// The model's name for the primary root (design D2).
const ROOT_ALIAS = 'root';

export interface OpAssembler {
  // One complete tool input, already JSON-parsed by the adapter. Returns the op to emit, or
  // undefined when no child survives truncation. Throws ProviderOutputError on invalid output.
  assemble(input: unknown): TreeOp | undefined;
  // At least one first-level node exists and every one of them has an emitted child.
  readonly complete: boolean;
}

interface OpAssemblerOptions {
  rootId: NodeId;
  idFactory: () => NodeId;
  caps: GenerationCaps;
}

interface EmittedNode {
  serverId: NodeId;
  depth: number;
  childCount: number;
}

// Created per attempt (design D2). Every check runs before any state changes, so a rejected
// call leaves the assembler as it was.
export function createOpAssembler({ rootId, idFactory, caps }: OpAssemblerOptions): OpAssembler {
  const emitted = new Map<string, EmittedNode>([
    [ROOT_ALIAS, { serverId: rootId, depth: 0, childCount: 0 }],
  ]);
  // A dropped node's descendants are dropped too, so this set alone answers "under a dropped id".
  const dropped = new Set<string>();
  let total = 0;

  function parseCall(input: unknown) {
    const result = generateToolInputSchema.safeParse(input);
    if (!result.success) {
      throw new ProviderOutputError('tool input does not match the add_children schema');
    }
    return result.data;
  }

  function resolveParent(parentId: string): EmittedNode | undefined {
    const parent = emitted.get(parentId);
    if (parent === undefined && !dropped.has(parentId)) {
      throw new ProviderOutputError('tool call names a parent that was never introduced');
    }
    return parent;
  }

  function assertFresh(ids: readonly string[]): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (emitted.has(id) || dropped.has(id) || seen.has(id)) {
        throw new ProviderOutputError('tool call reuses a temporary id');
      }
      seen.add(id);
    }
  }

  function admits(parent: EmittedNode): boolean {
    return parent.depth < caps.depth && parent.childCount < caps.perParent && total < caps.total;
  }

  function admit(parent: EmittedNode, child: { id: string; text: string }): NewNode | undefined {
    if (!admits(parent)) {
      dropped.add(child.id);
      return undefined;
    }
    const serverId = idFactory();
    emitted.set(child.id, { serverId, depth: parent.depth + 1, childCount: 0 });
    parent.childCount += 1;
    total += 1;
    return { id: serverId, text: child.text };
  }

  return {
    assemble(input) {
      const call = parseCall(input);
      const parent = resolveParent(call.parentId);
      assertFresh(call.children.map((child) => child.id));
      if (parent === undefined) {
        for (const child of call.children) dropped.add(child.id);
        return undefined;
      }
      const children = call.children
        .map((child) => admit(parent, child))
        .filter((child) => child !== undefined);
      if (children.length === 0) return undefined;
      return parseTreeOp({ op: 'add_children', parentId: parent.serverId, children });
    },
    get complete() {
      const firstLevel = [...emitted.values()].filter((node) => node.depth === 1);
      return firstLevel.length > 0 && firstLevel.every((node) => node.childCount > 0);
    },
  };
}
