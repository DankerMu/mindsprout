import { MindMapCanvas } from '../canvas/MindMapCanvas';
import { selectMap, useEditorStore } from './EditorSession';
import styles from './EditorView.module.css';

// The editor page body (design "Fixture — issue #16"): a header with the map title, never the
// primary root text, and the canvas over the store's map. data-testid="map-editor-ready" and
// data-testid="editor-title" are read by the e2e walks and later tasks.
export function EditorView() {
  const map = useEditorStore(selectMap);
  return (
    <div data-testid="map-editor-ready" className={styles.editor}>
      <header className={styles.header}>
        <h1 data-testid="editor-title" className={styles.title}>
          {map.title}
        </h1>
      </header>
      <div className={styles.canvas}>
        <MindMapCanvas map={map} />
      </div>
    </div>
  );
}
