import type { Edge, Node } from '@xyflow/react';
import {
  isValidNodeSize,
  type ForestLayout,
  type NodeSize,
} from '../../contexts/map/application/layout/layout-forest';
import type { ColorToken, MindMap, MindNode, NodeId } from '../../contexts/map/domain/types';

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

function flowNodeOf(
  current: MindNode,
  position: MindFlowNode['position'],
  size: NodeSize | undefined,
): MindFlowNode {
  const flowNode: MindFlowNode = {
    id: current.id,
    type: 'mindNode',
    position,
    data: dataOf(current),
  };
  // React Flow copies `measured` from each new node object and drops a node's handle bounds when
  // it is absent, so a rebuilt node without it is hidden and re-measured: a blink on every layout
  // change. The canvas's own valid measurement keeps it visible; an invalid one (laid out at its
  // estimate) must not mark the node measured.
  if (size !== undefined && isValidNodeSize(size)) {
    flowNode.measured = { width: size.width, height: size.height };
  }
  return flowNode;
}

// One node per laid-out id, in layout order (layoutForest lists positions in the map's pre-order,
// hidden nodes skipped). Never a width, height or style, and never layout.sizes: estimates written
// back would be measured back and the layout would never converge. `measured` comes only from the
// canvas's measurement state. Pure; throws on nothing, because layoutForest already validated the
// map.
export function toFlowElements(
  map: MindMap,
  layout: ForestLayout,
  measured: ReadonlyMap<NodeId, NodeSize>,
): { nodes: MindFlowNode[]; edges: Edge[] } {
  const nodes: MindFlowNode[] = [];
  for (const current of preorder(map.roots)) {
    const position = layout.positions.get(current.id);
    if (position !== undefined) {
      nodes.push(flowNodeOf(current, position, measured.get(current.id)));
    }
  }
  const edges = layout.edges.map(({ source, target }) => ({ id: target, source, target }));
  return { nodes, edges };
}
