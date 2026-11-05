import { createStore, type StoreApi } from 'zustand/vanilla';
import type { TreeOp } from '../../domain/tree-op';
import type { MindMap } from '../../domain/types';
import { GroupCancelledError, History } from '../history/history';

// The editor store (design D3, D10; decision 0003): the map changes only through History.dispatch
// → applyOp, metadata only through load and rename. The History is private to the store; its
// canUndo / canRedo / groupOpen are mirrored into state in the same set() as every map change.
// Vanilla store only: the React binding (`useStore` from `zustand`) lives in src/components.

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const DEFAULT_VIEWPORT: Viewport = Object.freeze({ x: 0, y: 0, zoom: 1 });

export type EditorStoreErrorCode = 'no-map';

export class EditorStoreError extends Error {
  override readonly name: string = 'EditorStoreError';
  readonly code: EditorStoreErrorCode;

  constructor(code: EditorStoreErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface EditorState {
  readonly map: MindMap | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly groupOpen: boolean;
  readonly viewport: Viewport;
  readonly notice: string | null;
  load(map: MindMap): void;
  dispatch(op: TreeOp): void;
  undo(): void;
  redo(): void;
  beginGroup(label: string): void;
  endGroup(): void;
  cancelGroup(): void;
  runGrouped(label: string, fn: () => void): void;
  rename(title: string): void;
  setViewport(viewport: Viewport): void;
  showNotice(message: string): void;
  clearNotice(): void;
}

export function createEditorStore(options: { now?: () => Date } = {}): StoreApi<EditorState> {
  const now = options.now ?? (() => new Date());
  // Replaced on every load: History entries address nodes by id, so another map must never
  // inherit undo steps (issue #12 note from PR #43).
  let history = new History();

  return createStore<EditorState>()((set, get) => {
    const requireMap = (action: string): MindMap => {
      const { map } = get();
      if (map === null) {
        throw new EditorStoreError('no-map', `${action} needs a loaded map`);
      }
      return map;
    };

    // The single write path for the map: the flags are read from History in the same set().
    const commit = (map: MindMap): void => {
      set({
        map,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        groupOpen: history.groupOpen,
      });
    };

    return {
      map: null,
      canUndo: false,
      canRedo: false,
      groupOpen: false,
      viewport: DEFAULT_VIEWPORT,
      notice: null,

      load(map) {
        history = new History();
        set({
          map,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          groupOpen: history.groupOpen,
          viewport: DEFAULT_VIEWPORT,
          notice: null,
        });
      },

      // An ungrouped TreeOpError propagates with state untouched. Inside a group, History has
      // already reverted and closed the group: keep its restored map, then rethrow the reducer's
      // TreeOpError so the caller never sees GroupCancelledError (design D3).
      dispatch(op) {
        const map = requireMap('dispatch');
        try {
          commit(history.dispatch(map, op));
        } catch (error) {
          if (!(error instanceof GroupCancelledError)) throw error;
          commit(error.restored);
          throw error.cause;
        }
      },

      undo() {
        commit(history.undo(requireMap('undo')));
      },

      redo() {
        commit(history.redo(requireMap('redo')));
      },

      beginGroup(label) {
        const map = requireMap('beginGroup');
        history.beginGroup(label);
        commit(map);
      },

      endGroup() {
        const map = requireMap('endGroup');
        history.endGroup();
        commit(map);
      },

      cancelGroup() {
        commit(history.cancelGroup(requireMap('cancelGroup')));
      },

      // beginGroup stays outside the try: when a group is already open it throws group-open and
      // that outer group must not be cancelled. A rejected dispatch has already closed the group,
      // so cancel only while it is still open — cancelling again would throw no-group and mask
      // the original error.
      runGrouped(label, fn) {
        const store = get();
        store.beginGroup(label);
        try {
          fn();
          store.endGroup();
        } catch (error) {
          if (history.groupOpen) store.cancelGroup();
          throw error;
        }
      },

      // Metadata, not tree state: no History entry, flags untouched (design D1).
      rename(title) {
        const map = requireMap('rename');
        set({ map: { ...map, title, updatedAt: now().toISOString() } });
      },

      // Stored as given; clamping zoom to 25–200% is the canvas's job.
      setViewport(viewport) {
        set({ viewport });
      },

      showNotice(message) {
        set({ notice: message });
      },

      clearNotice() {
        set({ notice: null });
      },
    };
  });
}
