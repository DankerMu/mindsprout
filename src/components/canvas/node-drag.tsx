import { useReactFlow, type NodeChange, type OnNodeDrag } from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { findNode } from '../../contexts/map/application/editor-store/selection';
import type { ForestLayout } from '../../contexts/map/application/layout/layout-forest';
import {
  captureNodeDrag,
  planNodeDrop,
  type DragSnapshot,
} from '../../contexts/map/application/node-drop';
import type { TreeOp } from '../../contexts/map/domain/tree-op';
import type { MindMap, MindNode, Position } from '../../contexts/map/domain/types';
import type { MindFlowNode } from './flow-elements';
import type { CanvasSelection } from './selection-input';

export interface CanvasDrag {
  commitDrop: (expectedMap: MindMap, selection: readonly string[], ops: readonly TreeOp[]) => void;
}
interface Gesture {
  map: MindMap;
  layout: ForestLayout;
  source: MindNode;
  touchId: number | null;
  drag: DragSnapshot;
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

function captureGesture(
  map: MindMap,
  layout: ForestLayout,
  selectedIds: readonly string[],
  id: string,
  event: MouseEvent | TouchEvent,
): Gesture | null {
  const touchId = 'changedTouches' in event ? event.changedTouches[0]?.identifier : null;
  if (touchId === undefined) return null;
  const source = findNode(map, id);
  const drag = captureNodeDrag(map, layout, selectedIds, id);
  if (source === undefined || drag === undefined) return null;
  return { map, layout, source, touchId, drag };
}

function useNativeDragInputs(gesture: RefObject<Gesture | null>, cancel: () => void) {
  const inputs = useRef({ mouseDown: false, touches: 0, colliding: false });
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
  }, [cancel, gesture]);
  return inputs;
}

export function useNodeDrag(
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
  const [active, setActive] = useState<Gesture | null>(null);
  const [quiescing, setQuiescing] = useState(false);
  const enabled = controls !== undefined && selection?.editing === null;
  const cancel = useCallback(() => {
    if (gesture.current !== null) setQuiescing(true);
    gesture.current = null;
    setActive(null);
    setPreview(null);
  }, []);
  const inputs = useNativeDragInputs(gesture, cancel);

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

  // Identity cleanup must not reorder native capture listeners behind D3's release handler.
  useEffect(() => cancel, [map, layout, enabled, cancel]);

  const selectedIds = selection?.selectedIds;
  const membershipMatches = useCallback(
    (current: Gesture) =>
      current.drag.selection.length === selectedIds?.length &&
      current.drag.selection.every((id) => selectedIds.includes(id)),
    [selectedIds],
  );

  useEffect(() => {
    if (gesture.current !== null && !membershipMatches(gesture.current)) cancel();
  }, [membershipMatches, cancel]);

  function currentGesture(): Gesture | null {
    const current = gesture.current;
    if (
      current === null ||
      !enabled ||
      current.map !== map ||
      current.layout !== layout ||
      !membershipMatches(current)
    )
      return null;
    return findNode(map, current.source.id) === current.source ? current : null;
  }

  const onNodeDragStart: OnNodeDrag<MindFlowNode> = (event, node) => {
    if (!enabled || blocked(event.target)) return;
    if (inputs.current.colliding || gesture.current !== null) {
      cancel();
      return;
    }
    const current = captureGesture(map, layout, selection.selectedIds, node.id, event);
    if (current === null) return;
    gesture.current = current;
    setActive(current);
    if (!selection.selectedIds.includes(node.id)) selection.select(node.id);
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
    const plan = planNodeDrop(
      current.map,
      current.layout,
      current.drag.selection,
      current.source.id,
      pointer,
      node.position,
    );
    if ('ops' in plan) controls?.commitDrop(map, current.drag.selection, plan.ops);
  };

  function onMouseDownCapture(event: ReactMouseEvent): void {
    if (!(event.target instanceof Element) || event.target.closest('.react-flow__node') === null)
      return;
    if (event.button !== 0) return;
    if (event.shiftKey || !enabled || blocked(event.target)) event.stopPropagation();
  }

  const projected = useMemo(() => {
    if (
      preview?.map !== map ||
      preview.layout !== layout ||
      !enabled ||
      !membershipMatches(preview)
    )
      return nodes;
    const dx = preview.position.x - preview.drag.anchor.x;
    const dy = preview.position.y - preview.drag.anchor.y;
    return nodes.map((node) => {
      const original = preview.drag.positions.get(node.id);
      return original === undefined
        ? node
        : { ...node, position: { x: original.x + dx, y: original.y + dy } };
    });
  }, [nodes, preview, map, layout, enabled, membershipMatches]);

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
