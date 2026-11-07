import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findNode, visibleIds } from '../../contexts/map/application/editor-store/selection';
import { MindMapCanvas } from '../canvas/MindMapCanvas';
import { NotePanel } from '../canvas/NotePanel';
import { NoticeToast } from '../NoticeToast';
import { StorageUnavailableBanner } from '../StorageUnavailableBanner';
import { selectMap, useEditorStore, useEditorStoreApi } from './EditorSession';
import styles from './EditorView.module.css';

// The editor page body (design "Fixture — issue #16"): a header with the map title, never the
// primary root text, and the canvas over the store's map. data-testid="map-editor-ready" and
// data-testid="editor-title" are read by the e2e walks and later tasks.
export function EditorView({ storageUnavailable = false }: { storageUnavailable?: boolean }) {
  const selection = useEditorStore((state) => state);
  const map = selectMap(selection);
  const store = useEditorStoreApi();
  const editing = selection.editing;
  const selectedId = selection.selectedIds.length === 1 ? selection.selectedIds[0] : undefined;
  const noteNode = selectedId === undefined ? undefined : findNode(map, selectedId);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const [noteFocusRequest, setNoteFocusRequest] = useState<{
    mapId: string;
    target: string;
  } | null>(null);
  const consumedNoteFocusRequest = useRef<typeof noteFocusRequest>(null);
  useLayoutEffect(() => {
    if (noteFocusRequest === null || consumedNoteFocusRequest.current === noteFocusRequest) return;
    consumedNoteFocusRequest.current = noteFocusRequest;
    const current = store.getState();
    if (
      current.map?.id === noteFocusRequest.mapId &&
      map.id === noteFocusRequest.mapId &&
      current.selectedIds.length === 1 &&
      current.selectedIds[0] === noteFocusRequest.target &&
      selectedId === noteFocusRequest.target
    )
      noteInput.current?.focus();
  }, [map.id, noteFocusRequest, selectedId, store]);
  useEffect(() => {
    const current = store.getState();
    if (current.editing !== editing || editing?.created !== false) return;
    if (!visibleIds(selectMap(current)).includes(editing.id)) current.cancelEdit();
  }, [editing, map, store]);

  // Detached inputs may blur after another edit starts; only their own live edit may finish.
  function finishTitle(text?: string): void {
    const current = store.getState();
    if (current.editing !== editing || editing === null) return;
    if (text !== undefined && visibleIds(selectMap(current)).includes(editing.id)) {
      current.commitTitle(text);
    } else current.cancelEdit();
  }
  const titleEditing = {
    editing,
    startEdit: (id: string) => {
      selection.startEdit(id);
    },
    createNode: (parentId: string, index?: number) => selection.createNode(parentId, index),
    commitTitle: (text: string) => {
      finishTitle(text);
    },
    cancelEdit: () => {
      finishTitle();
    },
  };
  return (
    <div data-testid="map-editor-ready" className={styles.editor}>
      <header className={styles.header}>
        <h1 data-testid="editor-title" className={styles.title}>
          {map.title}
        </h1>
      </header>
      <StorageUnavailableBanner
        storageUnavailable={storageUnavailable || selection.storageUnavailable}
      />
      <NoticeToast
        notice={selection.notice}
        onDismiss={() => {
          selection.clearNotice();
        }}
      />
      <div className={styles.canvas}>
        <MindMapCanvas
          map={map}
          selection={selection}
          titleEditing={titleEditing}
          history={selection}
          deletion={selection}
          menu={{
            getState: store.getState,
            requestNoteFocus: (target) => {
              setNoteFocusRequest({ mapId: map.id, target });
            },
          }}
          drag={{
            commitDrop: (expectedMap, expectedSelection, ops) => {
              const current = store.getState();
              if (
                current.map !== expectedMap ||
                current.editing !== null ||
                current.selectedIds.length !== expectedSelection.length ||
                !expectedSelection.every((id) => current.selectedIds.includes(id))
              )
                return;
              current.runGrouped('move', () => {
                for (const op of ops) current.dispatch(op);
              });
            },
          }}
        />
        {noteNode !== undefined && (
          <NotePanel
            key={JSON.stringify([map.id, noteNode.id])}
            node={noteNode}
            inputRef={noteInput}
            onCommit={(note) => {
              const current = store.getState();
              if (
                current.map?.id !== map.id ||
                current.selectedIds.length !== 1 ||
                current.selectedIds[0] !== noteNode.id
              )
                return;
              const target = findNode(selectMap(current), noteNode.id);
              if (target !== noteNode || (target.note ?? '') === (note ?? '')) return;
              current.dispatch({ op: 'update_node', id: noteNode.id, note });
            }}
          />
        )}
      </div>
    </div>
  );
}
