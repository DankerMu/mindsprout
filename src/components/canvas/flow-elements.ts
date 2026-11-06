import type { Edge, Node } from '@xyflow/react';
import type { ForestLayout } from '../../contexts/map/application/layout/layout-forest';
import type { ColorToken, MindMap, MindNode } from '../../contexts/map/domain/types';

// The React Flow view of a laid-out map (design D5, "Fixture — issue #15"). React Flow only
// renders these; it is never the source of truth.

// Extends Record<string, unknown> because React Flow constrains node data to it.
interface MindNodeData extends Record<string, unknown> {
  text: string;
  color: ColorToken | null;
  hasNote: boolean;
  // Every descendant in the map when the node is collapsed, else 0.
  hiddenCount: number;
}

export type MindFlowNode = Node<MindNodeData, 'mindNode'>;

function countDescendants(current: MindNode): number {
  return current.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function dataOf(current: MindNode): MindNodeData {
  return {
    text: current.text,
    color: current.color ?? null,
    hasNote: current.note !== undefined && current.note !== '',
    // Counted from the map: the layout drops a collapsed node's descendants.
    hiddenCount: current.collapsed === true ? countDescendants(current) : 0,
  };
}

function* preorder(nodes: readonly MindNode[]): Generator<MindNode> {
  for (const current of nodes) {
    yield current;
    yield* preorder(current.children);
  }
}

// One node per laid-out id, in layout order (layoutForest lists positions in the map's pre-order,
// hidden nodes skipped). Positions only: never a width, height, style or measured field, because
// sizes written back would be measured back and the layout would never converge. Pure; throws on
// nothing, because layoutForest already validated the map.
export function toFlowElements(
  map: MindMap,
  layout: ForestLayout,
): { nodes: MindFlowNode[]; edges: Edge[] } {
  const nodes: MindFlowNode[] = [];
  for (const current of preorder(map.roots)) {
    const position = layout.positions.get(current.id);
    if (position !== undefined) {
      nodes.push({ id: current.id, type: 'mindNode', position, data: dataOf(current) });
    }
  }
  const edges = layout.edges.map(({ source, target }) => ({ id: target, source, target }));
  return { nodes, edges };
}
