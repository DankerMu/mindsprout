import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { findNode, visibleIds } from '../../contexts/map/application/editor-store/selection';
import type { MindMap, MindNode, NodeId } from '../../contexts/map/domain/types';

export type CanvasSelection = Pick<
  EditorState,
  | 'selectedIds'
  | 'primaryId'
  | 'editing'
  | 'select'
  | 'toggleSelect'
  | 'setSelection'
  | 'selectAll'
  | 'clearSelection'
>;

function parentOf(nodes: readonly MindNode[], id: NodeId): MindNode | undefined {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === id)) return node;
    const parent = parentOf(node.children, id);
    if (parent !== undefined) return parent;
  }
  return undefined;
}

function firstChild(map: MindMap, id: NodeId): NodeId | undefined {
  const node = findNode(map, id);
  return node?.collapsed === true ? undefined : node?.children[0]?.id;
}

function arrowTarget(map: MindMap, id: NodeId, key: string): NodeId | undefined {
  if (key === 'ArrowRight') return firstChild(map, id);
  const parent = parentOf(map.roots, id);
  if (key === 'ArrowLeft') return parent?.id;
  const siblings = parent?.children;
  if (siblings === undefined) return undefined;
  const index = siblings.findIndex((sibling) => sibling.id === id);
  return siblings[index + (key === 'ArrowUp' ? -1 : 1)]?.id;
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}

export function selectionBlocked(
  selection: CanvasSelection,
  target: EventTarget | null,
  composing = false,
): boolean {
  return (
    selection.editing !== null ||
    composing ||
    isTextField(target) ||
    isTextField(document.activeElement)
  );
}

function selectionCommand(event: KeyboardEvent): 'all' | 'clear' | 'navigate' | undefined {
  if (event.altKey || event.shiftKey) return undefined;
  if (event.ctrlKey || event.metaKey) return event.key.toLowerCase() === 'a' ? 'all' : undefined;
  if (event.key === 'Escape') return 'clear';
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return 'navigate';
  return undefined;
}

export function handleSelectionKey(
  event: KeyboardEvent,
  map: MindMap,
  selection: CanvasSelection,
): void {
  if (selectionBlocked(selection, event.target, event.isComposing)) return;
  const command = selectionCommand(event);
  if (command === undefined) return;
  event.preventDefault();
  if (command === 'all') selection.selectAll();
  else if (command === 'clear') selection.clearSelection();
  else if (selection.primaryId !== null) {
    const target = arrowTarget(map, selection.primaryId, event.key);
    if (target !== undefined) selection.select(target);
  }
}

function isCreationKey(event: KeyboardEvent): boolean {
  return (
    (event.key === 'Tab' || event.key === 'Enter') &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.repeat
  );
}

export function isCompositionKey(event: KeyboardEvent): boolean {
  return (
    event.isComposing ||
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- decisions/implemented/bug-fix/0010-webkit-ime-keycode-compatibility.md
    event.keyCode === 229
  );
}

export function handleCreationKey(
  event: KeyboardEvent,
  map: MindMap,
  selection: CanvasSelection,
  controls: Pick<EditorState, 'createNode'> | undefined,
): void {
  if (!isCreationKey(event) || controls === undefined) return;
  if (selectionBlocked(selection, event.target, isCompositionKey(event))) return;
  if (selection.selectedIds.length !== 1) return;
  const id = selection.selectedIds[0];
  if (id === undefined || !visibleIds(map).includes(id)) return;
  event.preventDefault();
  const parent = event.key === 'Enter' ? parentOf(map.roots, id) : undefined;
  if (parent === undefined) controls.createNode(id);
  else controls.createNode(parent.id, parent.children.findIndex((child) => child.id === id) + 1);
}
