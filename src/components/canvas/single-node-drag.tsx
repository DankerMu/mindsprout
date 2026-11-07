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
  touchId: number | null;
}
interface Preview extends Gesture {
  position: Position;
}

function releasePoint(touchId: number | null, event: MouseEvent | TouchEvent) {
  if (!('changedTouches' in event)) return touchId === null ? event : undefined;
  for (const touch of event.changedTouches) {
    if (touch.identifier === touchId) return touch;
  }
  return undefined;
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
  const inputs = useRef({ mouseDown: false, touches: 0, colliding: false });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [active, setActive] = useState<Gesture | null>(null);
  const [quiescing, setQuiescing] = useState(false);
  const enabled =
    controls !== undefined &&
    selection !== undefined &&
    selection.selectedIds.length <= 1 &&
    selection.editing === null;
  const cancel = useCallback(() => {
    if (gesture.current !== null) setQuiescing(true);
    gesture.current = null;
    setActive(null);
    setPreview(null);
  }, []);

  useEffect(() => {
    if (!quiescing) return;
    // Keep the controlled flag false until already-queued XYDrag callbacks have observed it.
    const frame = requestAnimationFrame(() => {
      setQuiescing(false);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [quiescing]);

  useEffect(() => {
    const interrupt = () => {
      inputs.current.colliding = true;
      cancel();
    };
    const releaseIfIdle = () => {
      if (!inputs.current.mouseDown && inputs.current.touches === 0) {
        inputs.current.colliding = false;
      }
    };
    const mouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (inputs.current.mouseDown || inputs.current.touches > 0) interrupt();
      inputs.current.mouseDown = true;
    };
    const mouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return;
      inputs.current.mouseDown = false;
      releaseIfIdle();
    };
    const touchStart = (event: TouchEvent) => {
      inputs.current.touches = event.touches.length;
      if (inputs.current.mouseDown || event.touches.length > 1 || gesture.current !== null) {
        interrupt();
      }
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) interrupt();
    };
    const touchEnd = (event: TouchEvent) => {
      inputs.current.touches = event.touches.length;
      if (event.type === 'touchcancel') cancel();
      releaseIfIdle();
    };
    const resetInputs = () => {
      inputs.current = { mouseDown: false, touches: 0, colliding: false };
      cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    // Capture observes collisions even when XYDrag stops native touch-event propagation.
    window.addEventListener('mousedown', mouseDown, true);
    window.addEventListener('mouseup', mouseUp, true);
    window.addEventListener('touchstart', touchStart, true);
    window.addEventListener('touchmove', touchMove, true);
    window.addEventListener('touchend', touchEnd, true);
    window.addEventListener('touchcancel', touchEnd, true);
    window.addEventListener('pointercancel', resetInputs);
    window.addEventListener('blur', resetInputs);
    window.addEventListener('keydown', escape);
    return () => {
      cancel();
      window.removeEventListener('mousedown', mouseDown, true);
      window.removeEventListener('mouseup', mouseUp, true);
      window.removeEventListener('touchstart', touchStart, true);
      window.removeEventListener('touchmove', touchMove, true);
      window.removeEventListener('touchend', touchEnd, true);
      window.removeEventListener('touchcancel', touchEnd, true);
      window.removeEventListener('pointercancel', resetInputs);
      window.removeEventListener('blur', resetInputs);
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
    if (inputs.current.colliding || gesture.current !== null) {
      cancel();
      return;
    }
    const touchId = 'changedTouches' in event ? event.changedTouches[0]?.identifier : null;
    if (touchId === undefined) return;
    const source = findNode(map, node.id);
    if (source === undefined) return;
    gesture.current = { map, layout, source, touchId };
    setActive(gesture.current);
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
    if (current === null) return;
    if (current.source.id !== node.id) return;
    const point = releasePoint(current.touchId, event);
    if (point === undefined) return;
    cancel();
    if (blocked(event.target)) return;
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
    autoPanOnNodeDrag: enabled && !quiescing && active?.map === map && active.layout === layout,
    onNodesChange,
    onNodeDragStart,
    onNodeDragStop,
    onMouseDownCapture,
  };
}
