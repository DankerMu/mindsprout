'use client';

import '@xyflow/react/dist/style.css';
import {
  getViewportForBounds,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useKeyPress,
  useReactFlow,
  useStore,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  contentBounds,
  layoutForest,
  type ContentBounds,
  type ForestLayout,
  type NodeSize,
} from '../../contexts/map/application/layout/layout-forest';
import type { MindMap, NodeId, Position } from '../../contexts/map/domain/types';
import { toFlowElements, type MindFlowNode } from './flow-elements';
import { MindNodeView, NodeMeasurerContext, type NodeMeasurer } from './MindNodeView';
import { mergeNodeSizes, type NodeMeasurement } from './node-sizes';
import {
  handleCreationKey,
  handleDeletionKey,
  handleHistoryKey,
  handleSelectionKey,
  selectionBlocked,
  type CanvasDeletion,
  type CanvasHistory,
  type CanvasSelection,
} from './selection-input';
import { HistoryToolbar } from './HistoryToolbar';
import { useRubberBand } from './rubber-band';
import { handleTitleKey, TitleEditingContext, type CanvasEditing } from './InlineTitleInput';
import { useNodeDrag, type CanvasDrag } from './node-drag';
import { useContextMenu, type CanvasMenu } from './ContextMenu';

// Geometry remains a projection of the map and measured sizes; selection is supplied by the
// editor session. React Flow never writes selection or tree changes back into the map.

// Module-level so React Flow never sees a new nodeTypes object (its error002).
const NODE_TYPES: NodeTypes = { mindNode: MindNodeView };
// Middle button only; Space+drag keeps React Flow's default Space activation key (design D10).
const PAN_BUTTONS = [1];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const FIT_PADDING = 0.1;
const EDIT_PADDING = 16;

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
  private readonly elements = new Map<NodeId, HTMLElement>();

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
    this.elements.set(id, element);
    this.instance().observe(element);
  }

  unobserve(element: HTMLElement): void {
    const node = this.registered.get(element);
    if (node !== undefined) this.elements.delete(node.id);
    this.registered.delete(element);
    this.instance().unobserve(element);
  }

  elementOf(id: NodeId): HTMLElement | undefined {
    return this.elements.get(id);
  }

  disconnect(): void {
    this.observer?.disconnect();
  }
}

function useNodeSizes(): [NodeSizes, SharedNodeObserver] {
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

function revealOffset(start: number, size: number, span: number): number {
  const min = EDIT_PADDING - start;
  const max = span - EDIT_PADDING - start - size;
  // If the box cannot fit at this zoom, center it without changing zoom.
  return min > max ? (min + max) / 2 : Math.min(Math.max(0, min), max);
}

function revealNode(
  flow: ReactFlowInstance,
  canvas: NodeSize,
  position: Position,
  box: NodeSize,
): void {
  const viewport = flow.getViewport();
  const left = position.x * viewport.zoom + viewport.x;
  const top = position.y * viewport.zoom + viewport.y;
  if (Math.min(left, top, canvas.width - left - box.width, canvas.height - top - box.height) >= 0)
    return;

  const dx = revealOffset(left, box.width, canvas.width);
  const dy = revealOffset(top, box.height, canvas.height);
  if (dx || dy) void flow.setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy });
}

function ViewportControls({
  nodes,
  layout,
  editId,
  measurer,
  initialFitPendingRef,
}: {
  nodes: readonly MindFlowNode[];
  layout: ForestLayout;
  editId: NodeId | undefined;
  measurer: SharedNodeObserver;
  initialFitPendingRef: RefObject<boolean>;
}) {
  const bounds = useMemo(() => contentBounds(layout), [layout]);
  const flow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const fit = useCallback(
    (maxZoom: number, minZoom = MIN_ZOOM) => {
      if (bounds === undefined || !flow.viewportInitialized || !width || !height) return false;
      void flow.setViewport(
        getViewportForBounds(rectOf(bounds), width, height, minZoom, maxZoom, FIT_PADDING),
      );
      return true;
    },
    [bounds, flow, width, height],
  );
  useEffect(() => {
    if (editId !== undefined) initialFitPendingRef.current = false;
    if (
      initialFitPendingRef.current &&
      nodes.every((node) => node.measured !== undefined) &&
      fit(1, nodes.length === 1 ? 1 : MIN_ZOOM)
    )
      initialFitPendingRef.current = false;
  }, [editId, fit, initialFitPendingRef, nodes]);
  useEffect(() => {
    if (editId === undefined || !flow.viewportInitialized || !width || !height) return;
    const position = layout.positions.get(editId);
    // Editing can resize the box before the observer publishes the next layout.
    const box = measurer.elementOf(editId)?.getBoundingClientRect();
    if (position !== undefined && box?.width && box.height)
      revealNode(flow, { width, height }, position, box);
  }, [editId, flow, width, height, layout, measurer]);

  return (
    <button
      type="button"
      disabled={bounds === undefined}
      onClick={() => {
        if (fit(MAX_ZOOM)) initialFitPendingRef.current = false;
      }}
    >
      适应画布
    </button>
  );
}

interface CanvasProps {
  map: MindMap;
  selection?: CanvasSelection | undefined;
  titleEditing?: CanvasEditing | undefined;
  history?: CanvasHistory | undefined;
  deletion?: CanvasDeletion | undefined;
  drag?: CanvasDrag | undefined;
  menu?: CanvasMenu | undefined;
}

function CanvasView({ map, selection, titleEditing, history, deletion, drag, menu }: CanvasProps) {
  const composing = useRef(false);
  const initialFitPendingRef = useRef(true);
  const supersedeInitialFit = useCallback(() => {
    initialFitPendingRef.current = false;
  }, []);
  const onMoveStart = useCallback(
    (event: MouseEvent | TouchEvent | null) => {
      if (event instanceof Event) supersedeInitialFit();
    },
    [supersedeInitialFit],
  );
  const space = useKeyPress('Space', {
    target: typeof window === 'undefined' ? null : window,
  });
  const [sizes, measurer] = useNodeSizes();
  const layout = useMemo(
    () => layoutForest(map, { direction: 'LR', nodeSize: sizes }),
    [map, sizes],
  );
  const { nodes, edges } = useMemo(() => {
    const elements = toFlowElements(map, layout, sizes);
    const selected = new Set(selection?.selectedIds);
    for (const node of elements.nodes) node.selected = selected.has(node.id);
    return elements;
  }, [map, layout, sizes, selection?.selectedIds]);
  const contextMenu = useContextMenu(map, layout.positions, menu);
  const blocked = (target: EventTarget | null) =>
    selection === undefined || space || selectionBlocked(selection, target, composing.current);
  const { onMouseDownCapture, ...dragView } = useNodeDrag(
    map,
    layout,
    nodes,
    selection,
    drag,
    blocked,
    supersedeInitialFit,
  );
  const { rectangle, ...rubberBand } = useRubberBand(layout, blocked, (ids) =>
    selection?.setSelection(ids),
  );
  return (
    <NodeMeasurerContext value={measurer}>
      <TitleEditingContext value={titleEditing}>
        <div
          role="region"
          aria-label="思维导图画布"
          tabIndex={0}
          style={{ width: '100%', height: '100%', position: 'relative' }}
          {...rubberBand}
          onMouseDownCapture={space ? undefined : onMouseDownCapture}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDownCapture={(event) => {
            if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
            if (selection !== undefined && !composing.current) {
              handleSelectionKey(event.nativeEvent, map, selection);
              handleTitleKey(event.nativeEvent, selection, titleEditing);
              handleCreationKey(event.nativeEvent, map, selection, titleEditing);
              handleHistoryKey(event.nativeEvent, selection, history);
              handleDeletionKey(event.nativeEvent, selection, deletion);
            }
          }}
          onBlur={() => {
            composing.current = false;
          }}
        >
          <ReactFlow
            {...dragView}
            onMoveStart={onMoveStart}
            edges={edges}
            nodeTypes={NODE_TYPES}
            nodesDraggable={dragView.nodesDraggable && !space}
            nodeDragThreshold={0 /* Capture the grab offset at pointer-down, not the first move. */}
            nodesConnectable={false}
            elementsSelectable={false}
            disableKeyboardA11y
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            onNodeContextMenu={(event, node) => {
              if (blocked(event.target)) return;
              contextMenu.open(event, node.id);
            }}
            onNodeClick={(event, node) => {
              if (
                selection === undefined ||
                space ||
                selectionBlocked(selection, event.target, composing.current)
              )
                return;
              if (event.shiftKey) selection.toggleSelect(node.id);
              else selection.select(node.id);
              event.currentTarget.closest<HTMLElement>('[role="region"]')?.focus();
            }}
            onNodeDoubleClick={(event, node) => {
              if (titleEditing === undefined || selection === undefined || space) return;
              if (selectionBlocked(selection, event.target, composing.current)) return;
              titleEditing.startEdit(node.id);
            }}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            panOnDrag={PAN_BUTTONS}
            zoomOnDoubleClick={titleEditing === undefined}
          >
            <Panel position="top-right">
              {history !== undefined && <HistoryToolbar controls={history} />}
              <ViewportControls
                nodes={nodes}
                layout={layout}
                editId={titleEditing?.editing?.id}
                measurer={measurer}
                initialFitPendingRef={initialFitPendingRef}
              />
            </Panel>
          </ReactFlow>
          {contextMenu.menu}
          {rectangle !== null && (
            <div
              aria-hidden="true"
              style={{
                ...rectangle,
                position: 'absolute',
                pointerEvents: 'none',
                border: '1px solid #0969da',
                background: '#0969da22',
              }}
            />
          )}
        </div>
      </TitleEditingContext>
    </NodeMeasurerContext>
  );
}

export function MindMapCanvas({
  map,
  selection,
  titleEditing,
  history,
  deletion,
  drag,
  menu,
}: CanvasProps) {
  return (
    <ReactFlowProvider key={map.id}>
      <CanvasView
        map={map}
        selection={selection}
        titleEditing={titleEditing}
        history={history}
        deletion={deletion}
        drag={drag}
        menu={menu}
      />
    </ReactFlowProvider>
  );
}
