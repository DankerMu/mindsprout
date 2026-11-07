import { useState, type Ref } from 'react';
import type { MindNode } from '../../contexts/map/domain/types';
import styles from './NotePanel.module.css';

export function NotePanel({
  node,
  onCommit,
  inputRef,
}: {
  node: MindNode;
  onCommit: (note: string | null) => void;
  inputRef: Ref<HTMLTextAreaElement>;
}) {
  const [draft, setDraft] = useState({ source: node, value: node.note ?? '' });
  if (draft.source !== node) {
    setDraft({ source: node, value: node.note ?? '' });
  }

  return (
    <aside className={styles.panel} aria-label="备注">
      <label className={styles.label}>
        节点备注
        <textarea
          ref={inputRef}
          className={styles.input}
          value={draft.value}
          onChange={(event) => {
            setDraft({ source: node, value: event.target.value });
          }}
          onBlur={() => {
            if (draft.value === (node.note ?? '')) return;
            onCommit(draft.value === '' ? null : draft.value);
          }}
        />
      </label>
    </aside>
  );
}
