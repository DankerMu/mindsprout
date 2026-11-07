import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  expectFlags,
  expectHistoryError,
  expectStep,
  expectUnchanged,
  loaded,
  NOW,
} from '../../../../../tests/support/editor-store';
import { deepFreeze, mapOf, node } from '../../../../../tests/support/map-domain';
import { RecordingRepository } from '../../../../../tests/support/map-repository-stub';
import { createEditorStore, EditorStoreError } from './editor-store';

const A = node('a', [node('aa'), node('ab', [], { note: '保留备注' })]);
const B = node('b', [node('ba')], { color: 'blue' });
const F = node('f', [node('fa'), node('fb')], { position: { x: 300, y: 200 } });
const G = node('g', [], { position: { x: -100, y: 80 } });
const MAP = mapOf(node('r', [node('before'), A, node('between'), B, node('after')]), G, F);
const DELETED = mapOf(node('r', [node('before'), node('between'), node('after')]), G);
deepFreeze(MAP);

afterEach(() => {
  vi.useRealTimers();
});

describe('delete selection', () => {
  it('deletes nested selections once in one group and restores exact subtrees, order and positions', () => {
    const store = loaded(MAP);
    store.getState().setSelection(['fb', 'b', 'ab', 'f', 'a']);
    store.getState().openMenu('ab');
    store.getState().showNotice('保存失败');
    const before = store.getState();
    deepFreeze(before);
    store.getState().deleteSelection();
    expect(store.getState().map).toStrictEqual(DELETED);
    expect(store.getState()).toMatchObject({
      selectedIds: [],
      primaryId: null,
      menuTargetId: null,
      editing: null,
      notice: '保存失败',
    });
    expect(before.map).toBe(MAP);
    expect(before.selectedIds).toEqual(['fb', 'b', 'ab', 'f', 'a']);
    expectFlags(store, true, false);
    expectStep(store, 'undo', MAP, false, true);
    expectStep(store, 'redo', DELETED, true, false);
  });

  it('excludes the primary root before normalization without changing generic topmost selection', () => {
    const store = loaded(MAP);
    store.getState().setSelection(['r', 'ab', 'a', 'f', 'fb']);
    expect(store.getState().topmostSelected()).toEqual(['r', 'f']);
    store.getState().deleteSelection();
    const expected = mapOf(node('r', [node('before'), node('between'), B, node('after')]), G);
    expect(store.getState().map).toStrictEqual(expected);
    expect(store.getState()).toMatchObject({
      selectedIds: ['r'],
      primaryId: 'r',
      notice: '主根不能删除',
    });
    expectStep(store, 'undo', MAP, false, true);
    expectStep(store, 'redo', expected, true, false);
  });

  it('select all on an expanded forest leaves only the childless primary root', () => {
    const store = loaded(MAP);
    store.getState().selectAll();
    store.getState().deleteSelection();
    expect(store.getState().map).toStrictEqual(mapOf(node('r')));
    expect(store.getState().notice).toBe('主根不能删除');
    expectStep(store, 'undo', MAP, false, true);
    expectStep(store, 'redo', mapOf(node('r')), true, false);
  });

  it('deletes a collapsed selected subtree including its hidden descendants', () => {
    const map = mapOf(node('r', [node('a', [node('hidden')], { collapsed: true }), node('b')]));
    const store = loaded(map);
    store.getState().select('a');
    store.getState().deleteSelection();
    expect(store.getState().map).toStrictEqual(mapOf(node('r', [node('b')])));
    expectStep(store, 'undo', map, false, true);
  });

  it.each([{ ids: [] }, { ids: ['r'] }])(
    'preserves future and unselected children for no-op selection $ids',
    ({ ids }) => {
      const store = loaded(MAP);
      store.getState().dispatch({ op: 'update_node', id: 'r', text: '改名' });
      const renamed = store.getState().map;
      store.getState().undo();
      store.getState().setSelection(ids);
      store.getState().showNotice('保存失败');
      const before = store.getState();
      store.getState().deleteSelection();
      expect(store.getState().map).toBe(before.map);
      expect(store.getState().selectedIds).toBe(before.selectedIds);
      expect(store.getState().primaryId).toBe(before.primaryId);
      expect(store.getState().notice).toBe(ids.length === 0 ? '保存失败' : '主根不能删除');
      if (ids.length === 0) expect(store.getState()).toBe(before);
      expectFlags(store, false, true);
      store.getState().redo();
      expect(store.getState().map).toStrictEqual(renamed);
      expectFlags(store, true, false);
    },
  );

  it('does not consume prior history and clears future only for a real deletion', () => {
    const store = loaded(MAP);
    store.getState().dispatch({ op: 'update_node', id: 'r', text: '改名' });
    const renamed = store.getState().map;
    store.getState().dispatch({ op: 'update_node', id: 'g', text: '撤销的改名' });
    store.getState().undo();
    store.getState().select('a');
    store.getState().deleteSelection();
    expectFlags(store, true, false);
    store.getState().undo();
    expect(store.getState().map).toStrictEqual(renamed);
    expectFlags(store, true, true);
    expectStep(store, 'undo', MAP, false, true);
  });

  it('requires a loaded map without publishing a state or notice', () => {
    const store = createEditorStore();
    const error = expectUnchanged(store, (state) => {
      state.deleteSelection();
    });
    expect(error).toBeInstanceOf(EditorStoreError);
    expect(error).toMatchObject({ code: 'no-map' });
  });

  it.each(['rename', 'creation'])(
    'refuses deletion during %s without changing editing ownership',
    (mode) => {
      const store = loaded(MAP);
      store.getState().setSelection(['r', 'a']);
      store.getState().showNotice('保存失败');
      if (mode === 'rename') store.getState().startEdit('a');
      else store.getState().createNode('r');
      const error = expectUnchanged(store, (state) => {
        state.deleteSelection();
      });
      expect(error).toBeInstanceOf(EditorStoreError);
      expect(error).toMatchObject({ code: 'already-editing' });
      store.getState().cancelEdit();
      expect(store.getState().map).toStrictEqual(MAP);
      expectFlags(store, false, false);
    },
  );

  it('refuses a nested delete group without cancelling or changing the outer group', () => {
    const store = loaded(MAP);
    store.getState().beginGroup('outer');
    store.getState().dispatch({ op: 'update_node', id: 'r', text: '外层改名' });
    const outerMap = store.getState().map;
    store.getState().setSelection(['r', 'a']);
    store.getState().showNotice('保存失败');
    expectHistoryError(
      expectUnchanged(store, (state) => {
        state.deleteSelection();
      }),
      'group-open',
    );
    store.getState().endGroup();
    expect(store.getState().map).toBe(outerMap);
    expectStep(store, 'undo', MAP, false, true);
  });

  it('autosaves only final grouped delete and undo maps even when flushed during dispatch', async () => {
    vi.useFakeTimers();
    const repository = new RecordingRepository();
    const store = createEditorStore({ repository, now: () => new Date(NOW) });
    store.getState().load(MAP);
    store.getState().setSelection(['b', 'f', 'a']);
    const flushes: Promise<void>[] = [];
    const stop = store.subscribe((state) => {
      if (state.groupOpen) flushes.push(state.flush());
    });
    store.getState().deleteSelection();
    await Promise.all(flushes);
    expect(repository.puts).toEqual([]);
    await store.getState().flush();
    expect(repository.puts).toStrictEqual([{ ...DELETED, updatedAt: NOW }]);
    store.getState().undo();
    await store.getState().flush();
    expect(repository.puts).toStrictEqual([
      { ...DELETED, updatedAt: NOW },
      { ...MAP, updatedAt: NOW },
    ]);
    stop();
  });
});
