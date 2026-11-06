'use client';

import '@xyflow/react/dist/style.css';
import { Panel, ReactFlow, ReactFlowProvider, useReactFlow, type NodeTypes } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import {
  contentBounds,
  layoutForest,
  type ContentBounds,
  type NodeSize,
} from '../../contexts/map/application/layout/layout-forest';
import type { MindMap, NodeId } from '../../contexts/map/domain/types';
import { toFlowElements } from './flow-elements';
import { MindNodeView, NodeMeasurerContext, type NodeMeasurer } from './MindNodeView';
import { mergeNodeSizes, type NodeMeasurement } from './node-sizes';

// The read-only canvas over a map (design D4, D5, "Fixture — issue #15"). Rendered nodes and edges
// are a pure function of (map, measured sizes); React Flow's internal node state is never read back.

// Module-level so React Flow never sees a new nodeTypes object (its error002).
const NODE_TYPES: NodeTypes = { mindNode: MindNodeView };
// Middle button only; Space+drag keeps React Flow's default Space activation key (design D10).
const PAN_BUTTONS = [1];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const FIT_PADDING = 0.1;

type NodeSizes = ReadonlyMap<NodeId, NodeSize>;

// Old Safari (< 15.4) delivers entries without borderBoxSize, although the DOM type always has it.
interface ObservedBox {
  borderBoxSize?: readonly ResizeObserverSize[];
}

// The border box; offsetWidth/offsetHeight are the same box when the entry lacks borderBoxSize.
// Never getBoundingClientRect: it scales with the zoom.
function measurementOf(id: NodeId, entry: ObservedBox, element: HTMLElement): NodeMeasurement {
  const box = entry.borderBoxSize?.[0];
  if (box === undefined) return { id, width: element.offsetWidth, height: element.offsetHeight };
  return { id, width: box.inlineSize, height: box.blockSize };
}

// One ResizeObserver per canvas, shared by every node. Created on the first registration, which
// runs in the browser only (a ref callback), so server rendering never constructs one. After
// disconnect() it can observe again, as StrictMode's simulated remount needs.
class SharedNodeObserver implements NodeMeasurer {
  private observer: ResizeObserver | undefined;
  private readonly registered = new Map<Element, { id: NodeId; element: HTMLElement }>();

  constructor(private readonly onBatch: (batch: NodeMeasurement[]) => void) {}

  private instance(): ResizeObserver {
    this.observer ??= new ResizeObserver((entries) => {
      this.onBatch(entries.flatMap((entry) => this.measure(entry)));
    });
    return this.observer;
  }

  // A late entry for a node that has since unregistered is dropped.
  private measure(entry: ResizeObserverEntry): NodeMeasurement[] {
    const node = this.registered.get(entry.target);
    return node === undefined ? [] : [measurementOf(node.id, entry, node.element)];
  }

  observe(id: NodeId, element: HTMLElement): void {
    this.registered.set(element, { id, element });
    this.instance().observe(element);
  }

  unobserve(element: HTMLElement): void {
    this.registered.delete(element);
    this.instance().unobserve(element);
  }

  disconnect(): void {
    this.observer?.disconnect();
  }
}

function useNodeSizes(): [NodeSizes, NodeMeasurer] {
  const [sizes, setSizes] = useState<NodeSizes>(() => new Map());
  const [measurer] = useState(
    () =>
      new SharedNodeObserver((batch) => {
        setSizes((current) => mergeNodeSizes(current, batch));
      }),
  );
  useEffect(
    () => () => {
      measurer.disconnect();
    },
    [measurer],
  );
  return [sizes, measurer];
}

function rectOf({ minX, minY, maxX, maxY }: ContentBounds) {
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Frames every laid-out box, floating subtrees included; disabled when nothing is laid out.
function FitButton({ bounds }: { bounds: ContentBounds | undefined }) {
  const { fitBounds } = useReactFlow();
  const fit =
    bounds === undefined
      ? undefined
      : () => {
          void fitBounds(rectOf(bounds), { padding: FIT_PADDING });
        };
  return (
    <button type="button" disabled={fit === undefined} onClick={fit}>
      适应画布
    </button>
  );
}

function CanvasView({ map }: { map: MindMap }) {
  const [sizes, measurer] = useNodeSizes();
  const layout = useMemo(
    () => layoutForest(map, { direction: 'LR', nodeSize: sizes }),
    [map, sizes],
  );
  const { nodes, edges } = useMemo(() => toFlowElements(map, layout), [map, layout]);
  const bounds = useMemo(() => contentBounds(layout), [layout]);
  return (
    <NodeMeasurerContext value={measurer}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        panOnDrag={PAN_BUTTONS}
      >
        <Panel position="top-right">
          <FitButton bounds={bounds} />
        </Panel>
      </ReactFlow>
    </NodeMeasurerContext>
  );
}

export function MindMapCanvas({ map }: { map: MindMap }) {
  return (
    <ReactFlowProvider>
      <CanvasView map={map} />
    </ReactFlowProvider>
  );
}
