import { useReactFlow, type NodeChange, type OnNodeDrag } from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { findNode } from '../../contexts/map/application/editor-store/selection';
import type { ForestLayout } from '../../contexts/map/application/layout/layout-forest';
import { planSingleNodeDrop } from '../../contexts/map/application/single-node-drop';
import type { TreeOp } from '../../contexts/map/domain/tree-op';
import type { MindMap, MindNode, Position } from '../../contexts/map/domain/types';
import type { MindFlowNode } from './flow-elements';
import type { CanvasSelection } from './selection-input';

export interface CanvasDrag {
  commitDrop: (expectedMap: MindMap, op: TreeOp) => void;
}
interface Gesture {
  map: MindMap;
  layout: ForestLayout;
  source: MindNode;
}
interface Preview extends Gesture {
  position: Position;
}

export function useSingleNodeDrag(
  map: MindMap,
  layout: ForestLayout,
  nodes: MindFlowNode[],
  selection: CanvasSelection | undefined,
  controls: CanvasDrag | undefined,
  blocked: (target: EventTarget | null) => boolean,
) {
  const { screenToFlowPosition } = useReactFlow();
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const enabled =
    controls !== undefined &&
    selection !== undefined &&
    selection.selectedIds.length <= 1 &&
    selection.editing === null;
  const cancel = useCallback(() => {
    gesture.current = null;
    setPreview(null);
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    return () => {
      cancel();
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
    };
  }, [map, layout, enabled, cancel]);

  function currentGesture(): Gesture | null {
    const current = gesture.current;
    if (current === null || !enabled || current.map !== map || current.layout !== layout)
      return null;
    return findNode(map, current.source.id) === current.source ? current : null;
  }

  const onNodeDragStart: OnNodeDrag<MindFlowNode> = (event, node) => {
    if (!enabled || blocked(event.target)) return;
    const source = findNode(map, node.id);
    if (source === undefined) return;
    gesture.current = { map, layout, source };
    selection.select(node.id);
  };

  function onNodesChange(changes: NodeChange<MindFlowNode>[]): void {
    const current = currentGesture();
    if (current === null) return;
    for (const change of changes) {
      if (
        change.type === 'position' &&
        change.id === current.source.id &&
        change.position !== undefined
      ) {
        setPreview({ ...current, position: change.position });
      }
    }
  }

  const onNodeDragStop: OnNodeDrag<MindFlowNode> = (event, node) => {
    const current = currentGesture();
    cancel();
    if (current === null || blocked(event.target)) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (point === undefined) return;
    const pointer = screenToFlowPosition({ x: point.clientX, y: point.clientY });
    const plan = planSingleNodeDrop(map, current.layout, current.source.id, pointer, node.position);
    if ('op' in plan) controls?.commitDrop(map, plan.op);
  };

  function onMouseDownCapture(event: ReactMouseEvent): void {
    if (!(event.target instanceof Element) || event.target.closest('.react-flow__node') === null)
      return;
    if (event.button !== 0) return;
    if (event.shiftKey || !enabled || blocked(event.target)) event.stopPropagation();
  }

  const projected = useMemo(() => {
    if (preview?.map !== map || preview.layout !== layout || !enabled) return nodes;
    return nodes.map((node) =>
      node.id === preview.source.id ? { ...node, position: preview.position } : node,
    );
  }, [nodes, preview, map, layout, enabled]);

  return {
    nodes: projected,
    nodesDraggable: enabled,
    onNodesChange,
    onNodeDragStart,
    onNodeDragStop,
    onMouseDownCapture,
  };
}
