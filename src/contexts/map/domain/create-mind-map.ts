import type { MindMap, NodeId } from './types';

interface CreateMindMapInput {
  id: string;
  rootId: NodeId;
  title: string;
  rootText: string;
  // Injected clock keeps business logic free of ambient time; defaults to the wall clock.
  now?: () => Date;
}

// The only way to obtain a map with a primary root: no TreeOp creates one (design D1).
export function createMindMap({
  id,
  rootId,
  title,
  rootText,
  now = () => new Date(),
}: CreateMindMapInput): MindMap {
  const timestamp = now().toISOString();
  return {
    id,
    title,
    roots: [{ id: rootId, text: rootText, children: [] }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
