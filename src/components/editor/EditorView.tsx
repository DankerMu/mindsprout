import { useEffect } from 'react';
import { visibleIds } from '../../contexts/map/application/editor-store/selection';
import { MindMapCanvas } from '../canvas/MindMapCanvas';
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
        />
      </div>
    </div>
  );
}
