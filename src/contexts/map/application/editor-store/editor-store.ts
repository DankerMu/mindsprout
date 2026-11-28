import { nanoid } from 'nanoid';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { GenerateError, TreeOpError } from '../../domain/errors';
import type { GenerateInput, GenerateSource } from '../../domain/generate-source';
import type { MapRepository } from '../../domain/map-repository';
import type { TreeOp } from '../../domain/tree-op';
import type { MindMap, NodeId } from '../../domain/types';
import { GroupCancelledError, History } from '../history/history';
import { renameMetadata } from '../rename-map';
import { createAutosave, type Autosave } from './autosave';
import { generationNotice, SESSION_EXPIRED } from './generation-notice';
import {
  findNode,
  prune,
  topmost,
  visibleIds,
  type Editing,
  type SelectionSlice,
} from './selection';

export type { Editing } from './selection';
export { AUTOSAVE_DELAY_MS } from './autosave';
export { SESSION_EXPIRED } from './generation-notice';

// The editor store (design D3, D10; decision 0003): the map changes only through History.dispatch
// → applyOp, metadata only through load and rename. The History is private to the store; its
// canUndo / canRedo / groupOpen are mirrored into state in the same set() as every map change.
// Vanilla store only: the React binding (`useStore` from `zustand`) lives in src/components.
// The selection / editing / menu slice (design D3, D5; "Fixture — issue #35") only ever references
// nodes that exist (the selection: visible ones) — it is pruned in the same set() as every map
// change, and node creation is one History group owned by the inline edit until commit / cancel.
// Autosave (design D7, "Fixture — issue #13") runs only when a repository is injected: it writes
// the stable map (state.map observed while no group is open) after a change of identity, treats
// load as a new baseline, and reports failures through the notice until the stable map saves.
// Generation (design D9, "Issue #308 Fixture Triage"): one session at a time owns the `generate`
// group and the `generating` lock; every end path acts only while that session is the active one,
// so a stopped, reloaded or replaced session never touches a later session's group or notice.

export type EditorStoreErrorCode =
  | 'no-map'
  | 'unknown-node'
  | 'hidden-node'
  | 'already-editing'
  | 'not-editing'
  | 'generating'
  | 'not-empty'
  | 'invalid-topic'
  | 'no-source';

export class EditorStoreError extends Error {
  override readonly name: string = 'EditorStoreError';
  readonly code: EditorStoreErrorCode;

  constructor(code: EditorStoreErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface EditorState extends SelectionSlice {
  readonly map: MindMap | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly groupOpen: boolean;
  readonly notice: string | null;
  readonly generating: boolean;
  // Set by an ai-unavailable generation; kept for the store's lifetime (one store per editor visit).
  readonly aiUnavailable: boolean;
  load(map: MindMap): void;
  dispatch(op: TreeOp): void;
  undo(): void;
  redo(): void;
  beginGroup(label: string): void;
  endGroup(): void;
  cancelGroup(): void;
  runGrouped(label: string, fn: () => void): void;
  rename(title: string): void;
  showNotice(message: string): void;
  clearNotice(): void;
  select(id: NodeId): void;
  toggleSelect(id: NodeId): void;
  setSelection(ids: readonly NodeId[]): void;
  selectAll(): void;
  clearSelection(): void;
  openMenu(id: NodeId): void;
  closeMenu(): void;
  topmostSelected(): NodeId[];
  deleteSelection(): void;
  createNode(parentId: NodeId, index?: number): NodeId;
  startEdit(id: NodeId): void;
  commitTitle(text: string): void;
  cancelEdit(): void;
  flush(): Promise<void>;
  // Refusals throw synchronously; the returned promise rejects only for a source defect.
  generate(topic: string): Promise<void>;
  stopGeneration(): void;
}

type SelectionSnapshot = Pick<SelectionSlice, 'selectedIds' | 'primaryId'>;

const EMPTY_SLICE: SelectionSlice = Object.freeze({
  selectedIds: Object.freeze([]),
  primaryId: null,
  editing: null,
  menuTargetId: null,
});

const CREATION_LABEL = 'add node';
const GENERATE_LABEL = 'generate';
// The title MapLibrary gives a new map; only this title is replaced by the topic.
const DEFAULT_TITLE = '新导图';
// UTF-16 code units of the trimmed topic (spec "Invalid topic cannot be submitted").
const TOPIC_MAX_LENGTH = 200;

const SAVE_FAILED = '保存失败';

type SessionFlags = Partial<Pick<EditorState, 'generating' | 'aiUnavailable' | 'notice'>>;

// One generation. The object itself is the session token.
interface GenerationSession {
  readonly controller: AbortController;
  readonly topic: string;
  readonly rootId: NodeId;
  // Source ops dispatched; the root-text update_node is not counted.
  opsApplied: number;
  // The title this session replaced with the topic; null while it replaced none.
  renamedFrom: string | null;
}

// Feeds the autosave every stable map the store publishes; repeated failures do not republish notices.
function attachAutosave(
  api: StoreApi<EditorState>,
  repository: MapRepository,
  now: () => Date,
): Autosave {
  const autosave = createAutosave({
    repository,
    now,
    onUnauthorized: () => {
      if (api.getState().notice !== SESSION_EXPIRED) api.setState({ notice: SESSION_EXPIRED });
    },
    onFailed: () => {
      if (api.getState().notice !== SAVE_FAILED) api.setState({ notice: SAVE_FAILED });
    },
    onSaved: () => {
      const { notice } = api.getState();
      if (notice === SESSION_EXPIRED || notice === SAVE_FAILED) api.setState({ notice: null });
    },
  });
  api.subscribe(({ map, groupOpen }) => {
    if (map !== null && !groupOpen) autosave.observe(map);
  });
  return autosave;
}

export function createEditorStore(
  options: {
    now?: () => Date;
    newId?: () => NodeId;
    repository?: MapRepository;
    generateSource?: GenerateSource;
  } = {},
): StoreApi<EditorState> {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => nanoid());
  // Replaced on every load: History entries address nodes by id, so another map must never
  // inherit undo steps (issue #12 note from PR #43).
  let history = new History();
  // The selection createNode replaced; restored when the creation is abandoned.
  let beforeCreation: SelectionSnapshot = EMPTY_SLICE;
  // The active generation session; null while none runs.
  let session: GenerationSession | null = null;
  // The last notice a generation set: the next generation clears it at start, never a save notice.
  let generationNoticeShown: string | null = null;

  return createStore<EditorState>()((set, get, api) => {
    const autosave =
      options.repository === undefined ? undefined : attachAutosave(api, options.repository, now);

    const requireMap = (action: string): MindMap => {
      const { map } = get();
      if (map === null) {
        throw new EditorStoreError('no-map', `${action} needs a loaded map`);
      }
      return map;
    };

    // The generating lock: checked first in every tree-changing action (design D9).
    const requireNotGenerating = (action: string): void => {
      if (get().generating) {
        throw new EditorStoreError('generating', `${action} while a generation runs`);
      }
    };

    const requireIdle = (action: string): void => {
      const { editing } = get();
      if (editing !== null) {
        throw new EditorStoreError(
          'already-editing',
          `${action} while ${editing.id} is being edited`,
        );
      }
    };

    const requireEditing = (action: string): Editing => {
      const { editing } = get();
      if (editing === null)
        throw new EditorStoreError('not-editing', `${action} needs an open edit`);
      return editing;
    };

    // The creation group belongs to the inline edit: no other tree change enters it, and only
    // commitTitle / cancelEdit / load close it.
    const requireNoCreation = (action: string): void => {
      const { editing } = get();
      if (editing?.created === true) {
        throw new EditorStoreError(
          'already-editing',
          `${action} while ${editing.id} is being created`,
        );
      }
    };

    // Selection, editing and menu target address only nodes the user can see (design D5).
    const requireVisible = (map: MindMap, ids: readonly NodeId[]): void => {
      const visible = new Set(visibleIds(map));
      for (const id of ids) {
        if (visible.has(id)) continue;
        if (findNode(map, id) === undefined) {
          throw new EditorStoreError('unknown-node', `node ${id} is not in the map`);
        }
        throw new EditorStoreError('hidden-node', `node ${id} is hidden under a collapsed node`);
      }
    };

    // The single write path for the map: the flags are read from History and the selection slice
    // (with `changes` applied) is pruned against the new map, all in the same set().
    const commit = (
      map: MindMap,
      changes: Partial<SelectionSlice> = {},
      flags: SessionFlags = {},
    ): void => {
      const { selectedIds, primaryId, editing, menuTargetId } = get();
      set({
        map,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        groupOpen: history.groupOpen,
        ...prune(map, { selectedIds, primaryId, editing, menuTargetId, ...changes }),
        ...flags,
      });
    };

    // An ungrouped TreeOpError propagates with state untouched. Inside a group, History has
    // already reverted and closed the group: keep its restored map, then rethrow the reducer's
    // TreeOpError so the caller never sees GroupCancelledError (design D3). No creation rollback
    // is needed here: createNode's own rejection happens before the selection changes, dispatch is
    // refused during a creation edit, and commitTitle's update_node on the existing new node
    // cannot be rejected.
    const apply = (
      map: MindMap,
      mutate: (current: MindMap) => MindMap,
      changes: Partial<SelectionSlice> = {},
    ): void => {
      try {
        commit(mutate(map), changes);
      } catch (error) {
        if (!(error instanceof GroupCancelledError)) throw error;
        commit(error.restored);
        throw error.cause;
      }
    };

    const closeCreation = (map: MindMap): void => {
      commit(history.cancelGroup(map), { ...beforeCreation, editing: null });
    };

    // Created node: a title ends the group (create + name = one entry), a blank one cancels it.
    const commitCreated = (map: MindMap, id: NodeId, text: string): void => {
      if (text.trim() === '') {
        closeCreation(map);
        return;
      }
      const name = (current: MindMap): MindMap => {
        const next = history.dispatch(current, { op: 'update_node', id, text });
        history.endGroup();
        return next;
      };
      apply(map, name, { editing: null });
    };

    // Existing node: one ungrouped update for a real change; never blanked, never a no-op entry.
    const commitRename = (map: MindMap, id: NodeId, text: string): void => {
      if (text.trim() === '' || findNode(map, id)?.text === text) {
        set({ editing: null });
        return;
      }
      apply(map, (current) => history.dispatch(current, { op: 'update_node', id, text }), {
        editing: null,
      });
    };

    // Refusals of generate, in order; none of them changes state (design D9).
    const requireCanGenerate = (
      topic: string,
    ): { map: MindMap; source: GenerateSource; input: GenerateInput } => {
      const map = requireMap('generate');
      const source = options.generateSource;
      if (source === undefined) {
        throw new EditorStoreError('no-source', 'generate needs a generate source');
      }
      requireNotGenerating('generate');
      requireIdle('generate');
      const [root, ...floating] = map.roots;
      if (root === undefined || root.children.length > 0 || floating.length > 0) {
        throw new EditorStoreError('not-empty', 'generate needs a map with only an empty root');
      }
      const trimmed = topic.trim();
      if (trimmed === '' || trimmed.length > TOPIC_MAX_LENGTH) {
        throw new EditorStoreError(
          'invalid-topic',
          `generate needs a topic of 1 to ${String(TOPIC_MAX_LENGTH)} code units`,
        );
      }
      return { map, source, input: { topic: trimmed, rootId: root.id } };
    };

    const generationFlags = (notice: string | null): SessionFlags => {
      generationNoticeShown = notice;
      return { notice };
    };

    // The session's own dispatch: the same apply and History as dispatch, without the lock.
    const sessionDispatch = (op: TreeOp): void => {
      apply(requireMap('generate'), (current) => history.dispatch(current, op));
    };

    // Ends the active session: closes its group and clears the lock in one publication.
    const endSession = (flags: SessionFlags = {}): void => {
      session = null;
      history.endGroup();
      commit(requireMap('generate'), {}, { generating: false, ...flags });
    };

    // History has already reverted and closed the group, so no endGroup. Abort first: the loop
    // leaves (and the source's return() runs) only after this returns.
    const rejectSession = (active: GenerationSession): void => {
      active.controller.abort();
      session = null;
      const { renamedFrom, topic } = active;
      if (renamedFrom !== null && requireMap('generate').title === topic) get().rename(renamedFrom);
      set({ generating: false, ...generationFlags(generationNotice('invalid-output', 0)) });
    };

    // First op: the root text, then the default title (metadata, not an undo step), inside the group.
    const growRoot = (active: GenerationSession): void => {
      sessionDispatch({ op: 'update_node', id: active.rootId, text: active.topic });
      if (requireMap('generate').title !== DEFAULT_TITLE) return;
      active.renamedFrom = DEFAULT_TITLE;
      get().rename(active.topic);
    };

    // Returns false when the reducer rejected the op and the session ended.
    const receive = (active: GenerationSession, op: TreeOp): boolean => {
      try {
        if (active.opsApplied === 0) growRoot(active);
        sessionDispatch(op);
      } catch (error) {
        if (!(error instanceof TreeOpError)) throw error;
        rejectSession(active);
        return false;
      }
      active.opsApplied += 1;
      return true;
    };

    // A GenerateError picks the notice; anything else is a defect and is rethrown.
    const failSession = (active: GenerationSession, error: unknown): void => {
      if (!(error instanceof GenerateError)) {
        endSession();
        throw error;
      }
      if (error.code === 'ai-unavailable') endSession({ aiUnavailable: true });
      else endSession(generationFlags(generationNotice(error.code, active.opsApplied)));
    };

    // Every path acts only while `active` is still the session: after Stop, load or a newer
    // session, late ops, returns and errors are ignored (leaving the loop runs the source's return()).
    const runSession = async (
      active: GenerationSession,
      source: GenerateSource,
      input: GenerateInput,
    ): Promise<void> => {
      try {
        for await (const op of source.generate(input, active.controller.signal)) {
          if (session !== active || !receive(active, op)) return;
        }
      } catch (error) {
        if (session === active) failSession(active, error);
        return;
      }
      if (session === active) endSession();
    };

    return {
      map: null,
      canUndo: false,
      canRedo: false,
      groupOpen: false,
      notice: null,
      generating: false,
      aiUnavailable: false,
      ...EMPTY_SLICE,

      // Not an edit: a pending save of the previous map starts first, then map is the baseline.
      // A running generation is aborted and its session left inactive; aiUnavailable is kept.
      load(map) {
        session?.controller.abort();
        session = null;
        autosave?.rebase(map);
        history = new History();
        set({
          map,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          groupOpen: history.groupOpen,
          notice: null,
          generating: false,
          ...EMPTY_SLICE,
        });
      },

      // Refused while a new node is being named: the creation entry holds only its own ops, and
      // the created node cannot disappear under the edit (round-1 review of PR #48).
      dispatch(op) {
        requireNotGenerating('dispatch');
        const map = requireMap('dispatch');
        requireNoCreation('dispatch');
        apply(map, (current) => history.dispatch(current, op));
      },

      undo() {
        requireNotGenerating('undo');
        commit(history.undo(requireMap('undo')));
      },

      redo() {
        requireNotGenerating('redo');
        commit(history.redo(requireMap('redo')));
      },

      beginGroup(label) {
        requireNotGenerating('beginGroup');
        const map = requireMap('beginGroup');
        requireNoCreation('beginGroup');
        history.beginGroup(label);
        commit(map);
      },

      endGroup() {
        requireNotGenerating('endGroup');
        const map = requireMap('endGroup');
        requireNoCreation('endGroup');
        history.endGroup();
        commit(map);
      },

      cancelGroup() {
        requireNotGenerating('cancelGroup');
        const map = requireMap('cancelGroup');
        requireNoCreation('cancelGroup');
        commit(history.cancelGroup(map));
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
        set({ map: renameMetadata(map, title, now().toISOString()) });
      },

      showNotice(message) {
        set({ notice: message });
      },

      clearNotice() {
        set({ notice: null });
      },

      // Click: the node becomes the whole selection and the primary.
      select(id) {
        requireVisible(requireMap('select'), [id]);
        set({ selectedIds: [id], primaryId: id });
      },

      // Shift+click: an added node becomes primary; removing the primary falls back to the last
      // remaining id, removing any other node keeps the primary.
      toggleSelect(id) {
        requireVisible(requireMap('toggleSelect'), [id]);
        const { selectedIds, primaryId } = get();
        if (!selectedIds.includes(id)) {
          set({ selectedIds: [...selectedIds, id], primaryId: id });
          return;
        }
        const rest = selectedIds.filter((selected) => selected !== id);
        set({ selectedIds: rest, primaryId: primaryId === id ? (rest.at(-1) ?? null) : primaryId });
      },

      // Rubber-band: ids in the given order, first occurrence kept; primary = last selected id.
      setSelection(ids) {
        requireVisible(requireMap('setSelection'), ids);
        const selectedIds = [...new Set(ids)];
        set({ selectedIds, primaryId: selectedIds.at(-1) ?? null });
      },

      // Cmd/Ctrl+A: every visible node; an existing primary is always visible, so it is kept.
      selectAll() {
        const selectedIds = visibleIds(requireMap('selectAll'));
        set({ selectedIds, primaryId: get().primaryId ?? selectedIds[0] ?? null });
      },

      clearSelection() {
        requireMap('clearSelection');
        set({ selectedIds: [], primaryId: null });
      },

      openMenu(id) {
        requireVisible(requireMap('openMenu'), [id]);
        set({ menuTargetId: id });
      },

      closeMenu() {
        requireMap('closeMenu');
        set({ menuTargetId: null });
      },

      topmostSelected() {
        return topmost(requireMap('topmostSelected'), get().selectedIds);
      },

      deleteSelection() {
        requireNotGenerating('deleteSelection');
        const map = requireMap('deleteSelection');
        requireIdle('deleteSelection');
        const store = get();
        const rootId = map.roots[0]?.id;
        const rootSelected = store.selectedIds.some((id) => id === rootId);
        // Protect only the root itself; selected descendants remain deletion candidates (decision 0004).
        const targets = topmost(
          map,
          store.selectedIds.filter((id) => id !== rootId),
        );
        if (targets.length > 0) {
          store.runGrouped('delete', () => {
            for (const id of targets) store.dispatch({ op: 'delete_node', id });
          });
        }
        if (rootSelected) store.showNotice('主根不能删除');
      },

      // Tab / Enter / 添加子节点 (design D3): open the creation group, expand a collapsed parent
      // inside it, add an empty node, select it and start naming it — one published update.
      createNode(parentId, index) {
        requireNotGenerating('createNode');
        const map = requireMap('createNode');
        requireIdle('createNode');
        const { selectedIds, primaryId } = get();
        history.beginGroup(CREATION_LABEL);
        beforeCreation = { selectedIds, primaryId };
        const id = newId();
        const add: TreeOp = {
          op: 'add_children',
          parentId,
          children: [{ id, text: '' }],
          ...(index === undefined ? {} : { index }),
        };
        const create = (current: MindMap): MindMap => {
          const expanded =
            findNode(current, parentId)?.collapsed === true
              ? history.dispatch(current, { op: 'update_node', id: parentId, collapsed: false })
              : current;
          return history.dispatch(expanded, add);
        };
        apply(map, create, { selectedIds: [id], primaryId: id, editing: { id, created: true } });
        return id;
      },

      // F2 / double-click: rename an existing node — no group, selection untouched.
      startEdit(id) {
        requireNotGenerating('startEdit');
        const map = requireMap('startEdit');
        requireIdle('startEdit');
        requireVisible(map, [id]);
        set({ editing: { id, created: false } });
      },

      commitTitle(text) {
        requireNotGenerating('commitTitle');
        const map = requireMap('commitTitle');
        const { id, created } = requireEditing('commitTitle');
        if (created) commitCreated(map, id, text);
        else commitRename(map, id, text);
      },

      // Esc: abandon a created node (no entry), or discard a rename without dispatching.
      cancelEdit() {
        requireNotGenerating('cancelEdit');
        const map = requireMap('cancelEdit');
        if (requireEditing('cancelEdit').created) closeCreation(map);
        else set({ editing: null });
      },

      flush() {
        return autosave?.flush() ?? Promise.resolve();
      },

      // Not async: a refusal throws before the first await. The group opens before any state
      // changes, so a group-open refusal from History leaves no lock behind.
      generate(topic) {
        const { map, source, input } = requireCanGenerate(topic);
        history.beginGroup(GENERATE_LABEL);
        const active: GenerationSession = {
          controller: new AbortController(),
          ...input,
          opsApplied: 0,
          renamedFrom: null,
        };
        session = active;
        const { notice } = get();
        commit(
          map,
          {},
          { generating: true, notice: notice === generationNoticeShown ? null : notice },
        );
        return runSession(active, source, input);
      },

      // Synchronous, so unmount and pagehide can stop and then flush the stable partial map.
      stopGeneration() {
        if (session === null) return;
        session.controller.abort();
        endSession();
      },
    };
  });
}
