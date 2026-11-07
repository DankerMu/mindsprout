import type { StoreApi } from 'zustand/vanilla';
import { afterEach, describe, expect, it } from 'vitest';
import { mapOf, node } from '../../../tests/support/map-domain';
import {
  createEditorStore,
  type EditorState,
} from '../../contexts/map/application/editor-store/editor-store';
import { handleCreationKey, handleHistoryKey, handleSelectionKey } from './selection-input';

const MAP = mapOf(
  node('r', [node('a'), node('b', [node('hidden')], { collapsed: true }), node('c')]),
  node('f'),
);

afterEach(() => {
  document.body.replaceChildren();
});

function loaded() {
  const store = createEditorStore();
  store.getState().load(MAP);
  return store;
}

function press(store: StoreApi<EditorState>, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...options });
  handleSelectionKey(event, MAP, store.getState());
  return event;
}

describe('canvas selection keyboard', () => {
  it('selects exactly visible nodes with Control+A without changing map or history', () => {
    const store = loaded();
    const event = press(store, 'a', { ctrlKey: true });
    expect(store.getState().selectedIds).toEqual(['r', 'a', 'b', 'c', 'f']);
    expect(event.defaultPrevented).toBe(true);
    expect(store.getState().map).toBe(MAP);
    expect(store.getState().canUndo).toBe(false);
  });
  it('moves from the last clicked primary to its parent and replaces multi-selection', () => {
    const store = loaded();
    store.getState().select('f');
    store.getState().toggleSelect('b');
    expect(press(store, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(store.getState().selectedIds).toEqual(['r']);
    expect(store.getState().primaryId).toBe('r');
  });
  it('navigates children and siblings from the primary without wrapping, then clears', () => {
    const store = loaded();
    store.getState().select('r');
    press(store, 'ArrowRight');
    expect(store.getState().selectedIds).toEqual(['a']);
    store.getState().select('f');
    store.getState().toggleSelect('b');
    press(store, 'ArrowDown');
    expect(store.getState().selectedIds).toEqual(['c']);
    press(store, 'ArrowDown');
    expect(store.getState().selectedIds).toEqual(['c']);
    store.getState().select('f');
    store.getState().toggleSelect('b');
    press(store, 'ArrowUp');
    expect(store.getState().selectedIds).toEqual(['a']);
    press(store, 'ArrowUp');
    expect(store.getState().selectedIds).toEqual(['a']);
    expect(press(store, 'Escape').defaultPrevented).toBe(true);
    expect(store.getState().selectedIds).toEqual([]);
    expect(store.getState().primaryId).toBeNull();
  });
  it('leaves native text input shortcuts and the selection alone', () => {
    const store = loaded();
    store.getState().select('b');
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const before = store.getState();
    expect(press(store, 'a', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(store.getState()).toBe(before);
    input.remove();
  });

  it.each([
    ['r', 'ArrowLeft'],
    ['r', 'ArrowUp'],
    ['r', 'ArrowDown'],
    ['f', 'ArrowLeft'],
    ['f', 'ArrowUp'],
    ['f', 'ArrowDown'],
    ['b', 'ArrowRight'],
    ['a', 'ArrowRight'],
  ])('keeps %s selected for boundary key %s', (id, key) => {
    const store = loaded();
    store.getState().select(id);
    const before = store.getState();
    expect(press(store, key).defaultPrevented).toBe(true);
    expect(store.getState()).toBe(before);
  });

  it('handles empty selection and missing navigation targets without dispatch', () => {
    const store = loaded();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const before = store.getState();
      press(store, key);
      expect(store.getState()).toBe(before);
    }
    store.getState().select('b');
    const before = store.getState();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      handleSelectionKey(new KeyboardEvent('keydown', { key }), mapOf(), before);
      expect(store.getState()).toBe(before);
    }
  });

  it('selects all with Meta+A and retains the click primary', () => {
    const store = loaded();
    store.getState().select('b');
    expect(press(store, 'A', { metaKey: true }).defaultPrevented).toBe(true);
    expect(store.getState().selectedIds).toEqual(['r', 'a', 'b', 'c', 'f']);
    expect(store.getState().primaryId).toBe('b');
  });

  it.each(['input', 'textarea', 'select', 'div'])('ignores %s focus and event targets', (tag) => {
    const store = loaded();
    store.getState().select('b');
    const field = document.createElement(tag);
    if (tag === 'div') field.setAttribute('contenteditable', 'true');
    field.tabIndex = 0;
    document.body.append(field);
    const child = tag === 'div' ? field.appendChild(document.createElement('span')) : field;
    const before = store.getState();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'a']) {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: key === 'a',
        cancelable: true,
        bubbles: true,
      });
      field.addEventListener(
        'keydown',
        (received) => {
          handleSelectionKey(received, MAP, store.getState());
        },
        { once: true },
      );
      child.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      field.focus();
      expect(press(store, key, { ctrlKey: key === 'a' }).defaultPrevented).toBe(false);
      field.blur();
      expect(store.getState()).toBe(before);
    }
  });

  it('ignores editing and IME without swallowing native defaults', () => {
    const store = loaded();
    store.getState().select('b');
    store.getState().startEdit('a');
    const before = store.getState();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'a']) {
      expect(press(store, key, { ctrlKey: key === 'a' }).defaultPrevented).toBe(false);
      expect(store.getState()).toBe(before);
    }
    store.getState().cancelEdit();
    const idle = store.getState();
    expect(press(store, 'a', { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false);
    expect(store.getState()).toBe(idle);
  });

  it.each([
    ['Delete', {}],
    ['Backspace', {}],
    ['Tab', {}],
    ['Enter', {}],
    ['F2', {}],
    ['a', {}],
    ['z', { ctrlKey: true }],
    ['ArrowLeft', { metaKey: true }],
    ['ArrowRight', { shiftKey: true }],
    ['a', { ctrlKey: true, altKey: true }],
  ])('retains browser behavior for %s with %j', (key, options) => {
    const store = loaded();
    store.getState().select('b');
    const before = store.getState();
    expect(press(store, key, options).defaultPrevented).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it('navigates nested nodes to their actual parent', () => {
    const store = loaded();
    store.getState().dispatch({ op: 'update_node', id: 'b', collapsed: false });
    store.getState().select('hidden');
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    handleSelectionKey(event, MAP, store.getState());
    expect(store.getState().selectedIds).toEqual(['b']);
  });
});

describe('canvas creation controls', () => {
  it('ignores unavailable controls and unrelated keys without stealing browser defaults', () => {
    const store = loaded();
    store.getState().select('a');
    const before = store.getState();
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    handleCreationKey(event, MAP, before, undefined);
    expect(event.defaultPrevented).toBe(false);
    const unrelated = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });
    handleCreationKey(unrelated, MAP, before, before);
    expect(unrelated.defaultPrevented).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it('rejects a stale selection when its node is hidden or missing from the displayed map', () => {
    const store = loaded();
    store.getState().dispatch({ op: 'update_node', id: 'b', collapsed: false });
    store.getState().select('hidden');
    const before = store.getState();
    for (const map of [MAP, mapOf(node('r'))]) {
      for (const key of ['Tab', 'Enter']) {
        const event = new KeyboardEvent('keydown', { key, cancelable: true });
        handleCreationKey(event, map, before, before);
        expect(event.defaultPrevented).toBe(false);
        expect(store.getState()).toBe(before);
      }
    }
  });

  it('refuses creation while editing even when no text element is focused', () => {
    const store = loaded();
    store.getState().select('a');
    store.getState().startEdit('a');
    const before = store.getState();
    for (const key of ['Tab', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      handleCreationKey(event, MAP, before, before);
      expect(event.defaultPrevented).toBe(false);
      expect(store.getState()).toBe(before);
    }
  });
});

describe('canvas history controls', () => {
  it('leaves keys native without history controls, then uses the supplied store actions', () => {
    const store = loaded();
    store.getState().dispatch({ op: 'update_node', id: 'a', text: '改名' });
    const before = store.getState();
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
    handleHistoryKey(event, before, undefined);
    expect(event.defaultPrevented).toBe(false);
    expect(store.getState()).toBe(before);
    handleHistoryKey(event, before, before);
    expect(event.defaultPrevented).toBe(true);
    expect(store.getState().map).toEqual(MAP);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);
  });
});
