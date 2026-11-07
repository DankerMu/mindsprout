import { createContext, useLayoutEffect, useRef, useState } from 'react';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { isCompositionKey, selectionBlocked, type CanvasSelection } from './selection-input';

export type CanvasEditing = Pick<
  EditorState,
  'editing' | 'startEdit' | 'commitTitle' | 'cancelEdit' | 'createNode'
>;

export const TitleEditingContext = createContext<CanvasEditing | undefined>(undefined);

export function handleTitleKey(
  event: KeyboardEvent,
  selection: CanvasSelection,
  controls: CanvasEditing | undefined,
): void {
  if (event.key !== 'F2' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return;
  if (controls === undefined || selection.primaryId === null) return;
  if (selectionBlocked(selection, event.target, event.isComposing)) return;
  event.preventDefault();
  controls.startEdit(selection.primaryId);
}

export function InlineTitleInput({
  text,
  controls,
  measured,
}: {
  text: string;
  controls: CanvasEditing;
  measured: boolean;
}) {
  const [draft, setDraft] = useState(text);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const composing = useRef(false);
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (focused.current) return;
    // New React Flow nodes are hidden until measured; a hidden input cannot receive focus.
    input.current?.focus();
    input.current?.select();
    focused.current = document.activeElement === input.current;
  }, [measured]);
  function finish(cancel: boolean, restoreFocus: boolean): void {
    if (finished.current) return;
    finished.current = true;
    const region = input.current?.closest<HTMLElement>('[role="region"]');
    if (cancel) controls.cancelEdit();
    else controls.commitTitle(draft);
    if (restoreFocus) region?.focus();
  }
  return (
    <input
      ref={input}
      aria-label="节点标题"
      className="nodrag nopan nowheel"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        finish(false, false);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(event) => {
        if (composing.current || isCompositionKey(event.nativeEvent)) return;
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          finish(event.key === 'Escape', true);
        }
      }}
    />
  );
}
