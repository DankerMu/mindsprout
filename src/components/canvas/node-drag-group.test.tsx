import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import {
  borderBoxEntry,
  canvasObserverOf,
  mindNodeElement,
  renderedPosition,
} from '../../../tests/support/canvas';
import {
  MAP,
  move,
  observers,
  setup,
  start,
  stop,
  touchAt,
} from '../../../tests/support/canvas-drag';
import { node } from '../../../tests/support/map-domain';

function interruptGroup(
  reason: 'selection' | 'editing' | 'map' | 'layout' | 'collision',
  store: StoreApi<EditorState>,
) {
  if (reason === 'selection')
    act(() => {
      store.getState().setSelection(['f']);
    });
  if (reason === 'editing')
    act(() => {
      store.getState().startEdit('p');
    });
  if (reason === 'map')
    act(() => {
      store.getState().dispatch({ op: 'update_node', id: 'p', text: 'Changed' });
    });
  if (reason === 'layout')
    canvasObserverOf(observers()).fire([borderBoxEntry(mindNodeElement('r'), 100, 32)]);
  if (reason === 'collision') {
    const touch = touchAt(document.body, 9, 700, 500);
    fireEvent.touchStart(document.body, { touches: [touch], changedTouches: [touch] });
    fireEvent.touchEnd(document.body, { touches: [], changedTouches: [touch] });
  }
}

describe('group drag through the live editor', () => {
  it.each(['a', 'd'])(
    'moves nested selected subtrees once with %s as the native anchor',
    async (grabbed) => {
      const { store, repository } = setup();
      act(() => {
        store.getState().setSelection(['f', 'd', 'a']);
      });
      const before = store.getState().map;
      const origins = Object.fromEntries(
        ['a', 'd', 'f', 'p'].map((id) => [id, renderedPosition(id)] as const),
      );
      const anchor = start(grabbed);
      move(anchor.x + 120, anchor.y + 210);
      for (const id of ['a', 'd', 'f']) {
        const original = origins[id];
        if (original === undefined) throw new Error('missing preview origin');
        expect(renderedPosition(id)).toStrictEqual({ x: original.x + 100, y: original.y + 200 });
      }
      expect(renderedPosition('p')).toStrictEqual(origins.p);
      expect(store.getState().selectedIds).toStrictEqual(['f', 'd', 'a']);
      expect(store.getState().map).toBe(before);
      await act(() => store.getState().flush());
      expect(repository.puts).toStrictEqual([]);
      stop(anchor.x + 120, anchor.y + 210);
      const after = store.getState().map;
      expect(after).toStrictEqual({
        ...MAP,
        roots: [
          node('r', [node('p')]),
          node('f', [], { position: { x: 600, y: 400 } }),
          node('a', [node('d')], { position: { x: 212, y: 168 } }),
        ],
      });
      await act(() => store.getState().flush());
      expect(repository.puts).toHaveLength(1);
      expect(repository.puts[0]?.roots).toStrictEqual(after?.roots);
      act(() => {
        store.getState().undo();
      });
      expect(store.getState().map).toStrictEqual(MAP);
      expect(store.getState().canUndo).toBe(false);
      act(() => {
        store.getState().redo();
      });
      expect(store.getState().map).toStrictEqual(after);
    },
  );

  it('commits every frozen member onto a collapsed target despite selection pruning', () => {
    const { store } = setup();
    act(() => {
      store.getState().dispatch({ op: 'update_node', id: 'p', collapsed: true });
      store.getState().setSelection(['f', 'a']);
    });
    const before = store.getState().map;
    const destination = renderedPosition('p');
    start('a');
    move(destination.x + 10, destination.y + 10);
    stop(destination.x + 10, destination.y + 10);
    expect(store.getState().map).toStrictEqual({
      ...MAP,
      roots: [node('r', [node('p', [node('a', [node('d')]), node('f')], { collapsed: true })])],
    });
    expect(store.getState().selectedIds).toStrictEqual([]);
    expect(document.querySelector('[data-id="a"]')).toBeNull();
    expect(document.querySelector('[data-id="f"]')).toBeNull();
    act(() => {
      store.getState().undo();
    });
    expect(store.getState().map).toStrictEqual(before);
    act(() => {
      store.getState().undo();
    });
    expect(store.getState().map).toStrictEqual(MAP);
    expect(store.getState().canUndo).toBe(false);
  });

  it.each(['r', 'f', 'd'])(
    'refuses the entire group on %s and preserves prior redo',
    async (target) => {
      const { store, repository } = setup();
      act(() => {
        store.getState().dispatch({ op: 'update_node', id: 'p', text: 'Changed' });
        store.getState().undo();
        store.getState().setSelection(target === 'r' ? ['r', 'f'] : ['a', 'f']);
      });
      await act(() => store.getState().flush());
      const writes = repository.puts.length;
      const before = store.getState().map;
      const ids = ['r', 'a', 'd', 'p', 'f'];
      const origins = ids.map(renderedPosition);
      const destination = renderedPosition(target);
      const grabbed = target === 'r' ? 'r' : 'a';
      start(grabbed);
      move(420, 310);
      expect(renderedPosition(grabbed)).not.toStrictEqual(origins[ids.indexOf(grabbed)]);
      move(destination.x + 10, destination.y + 10);
      stop(destination.x + 10, destination.y + 10);
      expect(ids.map(renderedPosition)).toStrictEqual(origins);
      expect(store.getState().map).toBe(before);
      expect(store.getState().canUndo).toBe(false);
      expect(store.getState().canRedo).toBe(true);
      await act(() => store.getState().flush());
      expect(repository.puts).toHaveLength(writes);
      act(() => {
        store.getState().redo();
      });
      expect(store.getState().map?.roots[0]?.children[1]?.text).toBe('Changed');
    },
  );

  it.each(['selection', 'editing', 'map', 'layout', 'collision'] as const)(
    'discards every group preview on %s and permits an independent drag',
    (reason) => {
      const { store } = setup();
      act(() => {
        store.getState().setSelection(['a', 'f']);
      });
      const before = store.getState().map;
      const origin = start('a');
      move(420, 310);
      expect(renderedPosition('a')).toStrictEqual({ x: 400, y: 300 });
      interruptGroup(reason, store);
      const current = store.getState().map;
      stop(420, 310);
      expect(store.getState().map).toBe(current);
      if (reason !== 'map') expect(current).toBe(before);
      if (reason !== 'layout') expect(renderedPosition('a')).toStrictEqual(origin);
      expect(renderedPosition('f')).toStrictEqual({ x: 500, y: 200 });
      if (reason === 'editing')
        act(() => {
          store.getState().cancelEdit();
        });
      act(() => {
        store.getState().setSelection(['a', 'f']);
      });
      const destination = renderedPosition('p');
      start('a');
      move(destination.x + 10, destination.y + 10);
      stop(destination.x + 10, destination.y + 10);
      expect(store.getState().map?.roots).toHaveLength(1);
      expect(
        store.getState().map?.roots[0]?.children[0]?.children.map((child) => child.id),
      ).toStrictEqual(['a', 'f']);
    },
  );

  it.each(['selection', 'map', 'editing'] as const)(
    'rejects a group stop after a live %s change before React renders',
    (reason) => {
      const { store } = setup();
      act(() => {
        store.getState().setSelection(['a', 'f']);
      });
      start('a');
      move(420, 310);
      act(() => {
        if (reason === 'selection') store.getState().setSelection(['f']);
        if (reason === 'map')
          store.getState().dispatch({ op: 'update_node', id: 'p', text: 'Changed' });
        if (reason === 'editing') store.getState().startEdit('p');
        const before = store.getState().map;
        stop(420, 310);
        expect(store.getState().map).toBe(before);
      });
      expect(store.getState().map?.roots.map((root) => root.id)).toStrictEqual(['r', 'f']);
    },
  );
});
