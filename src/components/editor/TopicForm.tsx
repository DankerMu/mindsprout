import { useState } from 'react';
import { TOPIC_MAX_LENGTH } from '../../contexts/map/application/editor-store/editor-store';
import type { MindMap } from '../../contexts/map/domain/types';
import { selectMap, useEditorStore, useEditorStoreApi } from './EditorSession';
import styles from './TopicForm.module.css';

// The topic form ("Issue #310 Fixture Triage"): a bar in normal flow, rendered only over an empty
// map (the store's own rule: one root, no children). It never autofocuses: a focused input blocks
// the canvas shortcuts (selectionBlocked reads document.activeElement). Its draft survives a
// failed generation, so the user can retry.

function isEmptyMap(map: MindMap): boolean {
  const [root, ...floating] = map.roots;
  return root?.children.length === 0 && floating.length === 0;
}

function isValidTopic(draft: string): boolean {
  const length = draft.trim().length;
  return length > 0 && length <= TOPIC_MAX_LENGTH;
}

export function TopicForm() {
  const store = useEditorStoreApi();
  const empty = useEditorStore((state) => isEmptyMap(selectMap(state)));
  const generating = useEditorStore((state) => state.generating);
  const aiUnavailable = useEditorStore((state) => state.aiUnavailable);
  const [draft, setDraft] = useState('');
  if (!empty) return null;
  if (aiUnavailable) return <p className={styles.bar}>AI 未配置</p>;
  return (
    <form
      className={styles.bar}
      aria-label="生成导图"
      onSubmit={(event) => {
        event.preventDefault();
        // The store throws for a second or an invalid submit; here either is a no-op.
        const current = store.getState();
        if (current.generating || !isValidTopic(draft)) return;
        void current.generate(draft);
      }}
    >
      <input
        className={styles.input}
        aria-label="主题"
        placeholder="输入一个主题，AI 生成导图骨架"
        value={draft}
        readOnly={generating}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      {!generating && (
        <button type="submit" disabled={!isValidTopic(draft)}>
          生成
        </button>
      )}
    </form>
  );
}
