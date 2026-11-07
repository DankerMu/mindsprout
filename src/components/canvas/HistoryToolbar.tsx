import { useRef } from 'react';
import type { CanvasHistory } from './selection-input';

function HistoryButton({ controls, action }: { controls: CanvasHistory; action: 'undo' | 'redo' }) {
  const startedEditing = useRef(false);
  return (
    <button
      type="button"
      disabled={!(action === 'undo' ? controls.canUndo : controls.canRedo)}
      onPointerDown={() => {
        startedEditing.current = controls.editing !== null;
      }}
      onPointerCancel={() => {
        startedEditing.current = false;
      }}
      onClick={(event) => {
        // Blur may close a creation group before click; that gesture only finishes the editor.
        const dismissingEditor = event.detail !== 0 && startedEditing.current;
        startedEditing.current = false;
        if (dismissingEditor || controls.editing !== null) return;
        controls[action]();
      }}
    >
      {action === 'undo' ? '撤销' : '重做'}
    </button>
  );
}

export function HistoryToolbar({ controls }: { controls: CanvasHistory }) {
  return (
    <>
      <HistoryButton controls={controls} action="undo" />
      <HistoryButton controls={controls} action="redo" />
    </>
  );
}
