import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { failOnConsoleNoise, nodeWrapper } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import { EditorSession, useEditorStoreApi } from '../editor/EditorSession';
import { EditorView } from '../editor/EditorView';

failOnConsoleNoise();
const MAP = mapOf(node('r', [node('a'), node('b')]));
const RENAMED = { ...MAP, roots: [node('r', [node('a', [], { text: 'B' }), node('b')])] };

function editor() {
  let store: StoreApi<EditorState> | undefined;
  function Probe() {
    store = useEditorStoreApi();
    return null;
  }
  render(
    <EditorSession map={MAP} repository={new RecordingRepository()}>
      <Probe />
      <EditorView />
    </EditorSession>,
  );
  return () => {
    if (store === undefined) throw new Error('missing editor session');
    return store.getState();
  };
}

function rename(text = 'B') {
  fireEvent.doubleClick(nodeWrapper('a'));
  fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: text } });
  fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Enter' });
}

function flags(undo: boolean, redo: boolean) {
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '撤销' }).disabled).toBe(!undo);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '重做' }).disabled).toBe(!redo);
}

describe('history through the editor canvas', () => {
  it('Enter on a history button leaves native activation intact instead of creating a node', () => {
    const state = editor();
    rename();
    fireEvent.click(nodeWrapper('r'));
    const button = screen.getByRole('button', { name: '撤销' });
    act(() => {
      button.focus();
    });
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
    fireEvent.click(button);
    expect(state().editing).toBeNull();
    expect(state().map).toEqual(MAP);
    flags(false, true);
  });

  it.each(['pointercancel', 'release-outside'])(
    'a cancelled %s gesture cannot suppress later keyboard or pointer activation',
    (cancellation) => {
      const state = editor();
      rename();
      fireEvent.click(nodeWrapper('r'));
      fireEvent.keyDown(screen.getByRole('region'), { key: 'Tab' });
      const button = screen.getByRole('button', { name: '撤销' });
      fireEvent.pointerDown(button, { pointerId: 1 });
      act(() => {
        button.focus();
      });
      if (cancellation === 'pointercancel') fireEvent.pointerCancel(button, { pointerId: 1 });
      else fireEvent.pointerUp(document.body, { pointerId: 1 });
      expect(state().map).toEqual(RENAMED);
      fireEvent.click(button, { detail: 0 });
      expect(state().map).toEqual(MAP);
      fireEvent.keyDown(button, { key: 'z', ctrlKey: true, shiftKey: true });
      expect(state().map).toEqual(RENAMED);
      fireEvent.pointerDown(button, { pointerId: 2 });
      fireEvent.pointerUp(button, { pointerId: 2 });
      fireEvent.click(button, { detail: 1 });
      expect(state().map).toEqual(MAP);
    },
  );

  it.each(['Enter', 'Escape', 'blur'])(
    'a terminal %s event leaves the next activation live',
    (terminal) => {
      const state = editor();
      rename();
      fireEvent.doubleClick(nodeWrapper('a'));
      const input = screen.getByLabelText('节点标题');
      fireEvent.change(input, { target: { value: 'C' } });
      const button = screen.getByRole('button', { name: '撤销' });
      fireEvent.click(button);
      expect(state().editing).not.toBeNull();
      expect(state().map).toEqual(RENAMED);
      if (terminal === 'blur') {
        act(() => {
          button.focus();
        });
      } else fireEvent.keyDown(input, { key: terminal });
      fireEvent.blur(input);
      fireEvent.click(button);
      expect(state().map).toEqual(terminal === 'Escape' ? MAP : RENAMED);
      flags(terminal !== 'Escape', true);
    },
  );

  it('a pointer gesture commits a named creation without also undoing it', () => {
    const state = editor();
    rename();
    fireEvent.click(nodeWrapper('r'));
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Tab' });
    const id = state().editing?.id;
    if (id === undefined) throw new Error('missing created node');
    fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '新节点' } });
    const button = screen.getByRole('button', { name: '撤销' });
    fireEvent.pointerDown(button, { pointerId: 1 });
    act(() => {
      button.focus();
    });
    fireEvent.click(button, { detail: 1 });
    expect(state().map).toEqual({
      ...MAP,
      roots: [
        node('r', [node('a', [], { text: 'B' }), node('b'), { id, text: '新节点', children: [] }]),
      ],
    });
    expect(state().groupOpen).toBe(false);
    fireEvent.click(button);
    expect(state().map).toEqual(RENAMED);
    expect(state().selectedIds).toEqual([]);
    flags(true, true);
  });

  it.each(['ctrlKey', 'metaKey'])(
    'preserves native editing, composition and unsupported %s keys',
    (modifier) => {
      const state = editor();
      rename();
      const region = screen.getByRole('region');
      for (const options of [
        { key: 'y', [modifier]: true },
        { key: 'z' },
        { key: 'z', [modifier]: true, altKey: true },
        { key: 'z', [modifier]: true, isComposing: true },
        { key: 'z', [modifier]: true, keyCode: 229 },
      ]) {
        expect(fireEvent.keyDown(region, options)).toBe(true);
        expect(state().map).toEqual(RENAMED);
      }
      fireEvent.compositionStart(region);
      expect(fireEvent.keyDown(region, { key: 'z', [modifier]: true })).toBe(true);
      fireEvent.compositionEnd(region);
      fireEvent.doubleClick(nodeWrapper('a'));
      for (const shiftKey of [false, true]) {
        const options = { key: 'z', [modifier]: true, shiftKey };
        expect(fireEvent.keyDown(region, options)).toBe(true);
        expect(fireEvent.keyDown(screen.getByLabelText('节点标题'), options)).toBe(true);
        expect(state().map).toEqual(RENAMED);
        flags(true, false);
      }
      fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Escape' });
      expect(fireEvent.keyDown(region, { key: 'z', [modifier]: true })).toBe(false);
      expect(state().map).toEqual(MAP);
    },
  );

  it.each(['input', 'textarea', 'select', 'div'])(
    'leaves %s target and active focus native',
    (tag) => {
      const state = editor();
      rename();
      const region = screen.getByRole('region');
      const field = document.createElement(tag);
      field.tabIndex = 0;
      if (tag === 'div') field.setAttribute('contenteditable', 'true');
      region.append(field);
      const target = tag === 'div' ? field.appendChild(document.createElement('span')) : field;
      for (const modifier of ['ctrlKey', 'metaKey']) {
        for (const shiftKey of [false, true]) {
          expect(fireEvent.keyDown(target, { key: 'z', [modifier]: true, shiftKey })).toBe(true);
          field.focus();
          expect(fireEvent.keyDown(region, { key: 'z', [modifier]: true, shiftKey })).toBe(true);
          field.blur();
          expect(state().map).toEqual(RENAMED);
          flags(true, false);
        }
      }
      field.remove();
      fireEvent.keyDown(region, { key: 'z', ctrlKey: true });
      expect(state().map).toEqual(MAP);
    },
  );

  it.each(['撤销', '重做'])(
    'a gesture dismissing an empty creation preserves %s history',
    (label) => {
      const state = editor();
      rename();
      if (label === '重做') fireEvent.click(screen.getByRole('button', { name: '撤销' }));
      const before = state();
      fireEvent.click(nodeWrapper('r'));
      fireEvent.keyDown(screen.getByRole('region'), { key: 'Tab' });
      const input = screen.getByLabelText('节点标题');
      expect(state().groupOpen).toBe(true);
      flags(before.canUndo, before.canRedo);
      const button = screen.getByRole('button', { name: label });
      expect(fireEvent.pointerDown(button, { pointerId: 1, button: 0 })).toBe(true);
      act(() => {
        button.focus();
      });
      expect(state().groupOpen).toBe(false);
      fireEvent.pointerUp(button, { pointerId: 1 });
      fireEvent.click(button, { detail: 1 });
      expect(input.isConnected).toBe(false);
      expect(state().map).toEqual(before.map);
      flags(before.canUndo, before.canRedo);
      fireEvent.pointerDown(button, { pointerId: 2, button: 0 });
      fireEvent.pointerUp(button, { pointerId: 2 });
      fireEvent.click(button, { detail: 1 });
      expect(state().map).toEqual(label === '撤销' ? MAP : RENAMED);
      flags(label === '重做', label === '撤销');
    },
  );

  it('abandoning creation preserves both past and future entries in order', () => {
    const state = editor();
    rename();
    rename('C');
    const undo = screen.getByRole('button', { name: '撤销' });
    const redo = screen.getByRole('button', { name: '重做' });
    fireEvent.click(undo);
    flags(true, true);
    fireEvent.click(nodeWrapper('r'));
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Tab' });
    fireEvent.pointerDown(undo, { pointerId: 1 });
    act(() => {
      undo.focus();
    });
    fireEvent.click(undo, { detail: 1 });
    expect(state().map).toEqual(RENAMED);
    flags(true, true);
    fireEvent.click(undo);
    expect(state().map).toEqual(MAP);
    flags(false, true);
    fireEvent.click(redo);
    expect(state().map).toEqual(RENAMED);
    flags(true, true);
    fireEvent.click(redo);
    expect(state().map).toEqual({
      ...MAP,
      roots: [node('r', [node('a', [], { text: 'C' }), node('b')])],
    });
    flags(true, false);
  });

  it('binds both buttons to history across commit, undo, redo and a new edit', () => {
    const state = editor();
    flags(false, false);
    rename();
    flags(true, false);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(state().map).toEqual(MAP);
    flags(false, true);
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(state().map).toEqual(RENAMED);
    flags(true, false);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    rename('C');
    expect(state().map).toEqual({
      ...MAP,
      roots: [node('r', [node('a', [], { text: 'C' }), node('b')])],
    });
    flags(true, false);
  });

  it.each(['ctrlKey', 'metaKey'])('undoes and redoes without selection using %s', (modifier) => {
    const state = editor();
    rename();
    act(() => {
      state().clearSelection();
    });
    expect(state().selectedIds).toEqual([]);
    expect(state().map).toEqual(RENAMED);
    expect(fireEvent.keyDown(screen.getByRole('region'), { key: 'z', [modifier]: true })).toBe(
      false,
    );
    expect(state().map).toEqual(MAP);
    expect(state().canUndo).toBe(false);
    expect(state().canRedo).toBe(true);
    expect(
      fireEvent.keyDown(screen.getByRole('region'), {
        key: 'Z',
        [modifier]: true,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(state().map).toEqual(RENAMED);
    expect(state().canUndo).toBe(true);
    expect(state().canRedo).toBe(false);
  });
});
