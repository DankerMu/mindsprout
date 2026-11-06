import { useReactFlow, type XYPosition } from '@xyflow/react';
import { useRef, useState, type PointerEvent } from 'react';
import type { ForestLayout } from '../../contexts/map/application/layout/layout-forest';
import type { NodeId } from '../../contexts/map/domain/types';

interface Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

function rectangleBetween(start: XYPosition, end: XYPosition): Rectangle {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function enclosedIds(layout: ForestLayout, area: Rectangle): NodeId[] {
  const ids: NodeId[] = [];
  for (const [id, position] of layout.positions) {
    const size = layout.sizes.get(id);
    if (size === undefined) throw new Error(`rubberBand: node ${id} has a position but no size`);
    if (
      position.x >= area.left &&
      position.y >= area.top &&
      position.x + size.width <= area.left + area.width &&
      position.y + size.height <= area.top + area.height
    )
      ids.push(id);
  }
  return ids;
}

export function useRubberBand(
  layout: ForestLayout,
  blocked: (target: EventTarget) => boolean,
  select: (ids: NodeId[]) => void,
) {
  const { screenToFlowPosition } = useReactFlow();
  const start = useRef<(XYPosition & { pointerId: number }) | null>(null);
  const [rectangle, setRectangle] = useState<Rectangle | null>(null);

  function onPointerDownCapture(event: PointerEvent<HTMLDivElement>): void {
    if (
      event.button !== 0 ||
      event.pointerType !== 'mouse' ||
      !event.isPrimary ||
      blocked(event.target) ||
      !(event.target instanceof Element) ||
      !event.target.classList.contains('react-flow__pane')
    )
      return;
    start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  }

  function onPointerMoveCapture(event: PointerEvent<HTMLDivElement>): void {
    if (start.current?.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const rect = rectangleBetween(start.current, { x: event.clientX, y: event.clientY });
    setRectangle({ ...rect, left: rect.left - bounds.left, top: rect.top - bounds.top });
  }

  function cancel(): void {
    start.current = null;
    setRectangle(null);
  }

  function onPointerUpCapture(event: PointerEvent<HTMLDivElement>): void {
    if (start.current?.pointerId !== event.pointerId) return;
    const origin = start.current;
    cancel();
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (blocked(event.target) || (origin.x === event.clientX && origin.y === event.clientY)) return;
    const area = rectangleBetween(
      screenToFlowPosition(origin),
      screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    );
    select(enclosedIds(layout, area));
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>): void {
    if (start.current?.pointerId === event.pointerId) cancel();
  }

  return {
    rectangle,
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture,
    onPointerCancel,
    onLostPointerCapture: onPointerCancel,
  };
}
