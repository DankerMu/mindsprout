import { createContext, useLayoutEffect, useRef, useState } from 'react';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { selectionBlocked, type CanvasSelection } from './selection-input';

export type CanvasEditing = Pick<
  EditorState,
  'editing' | 'startEdit' | 'commitTitle' | 'cancelEdit'
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

export function InlineTitleInput({ text, controls }: { text: string; controls: CanvasEditing }) {
  const [draft, setDraft] = useState(text);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const composing = useRef(false);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
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
        // WebKit can end composition before Enter while retaining the IME keyCode 229.
        if (
          composing.current ||
          event.nativeEvent.isComposing ||
          // eslint-disable-next-line @typescript-eslint/no-deprecated -- decisions/implemented/bug-fix/0010-webkit-ime-keycode-compatibility.md
          event.nativeEvent.keyCode === 229
        )
          return;
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          finish(event.key === 'Escape', true);
        }
      }}
    />
  );
}
