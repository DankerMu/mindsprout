import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failOnConsoleNoise, nodeWrapper } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { History } from '../../contexts/map/application/history/history';
import { EditorSession, useEditorStore } from '../editor/EditorSession';
import { EditorView } from '../editor/EditorView';

failOnConsoleNoise();
afterEach(() => {
  vi.restoreAllMocks();
});

const MAP = { ...mapOf(node('r', [node('a'), node('b'), node('c')])), title: '导图标题' };

function renderEditor() {
  let state: EditorState;
  function Probe() {
    state = useEditorStore((current) => current);
    return null;
  }
  render(
    <EditorSession map={MAP} repository={new RecordingRepository()}>
      <Probe />
      <EditorView />
      <button type="button">目的地</button>
    </EditorSession>,
  );
  return () => state;
}

function openTitle(id = 'a'): HTMLInputElement {
  fireEvent.doubleClick(nodeWrapper(id));
  return screen.getByLabelText('节点标题');
}

function draft(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function expectOneRename(state: () => EditorState, id: string, text: string) {
  expect(nodeWrapper(id).textContent).toBe(text);
  expect(state().editing).toBeNull();
  expect(state().canUndo).toBe(true);
  act(() => {
    state().undo();
  });
  expect(state().map).toEqual(MAP);
  expect(state().canUndo).toBe(false);
  expect(state().canRedo).toBe(true);
  act(() => {
    state().redo();
  });
  expect(nodeWrapper(id).textContent).toBe(text);
  expect(state().canRedo).toBe(false);
}

describe('inline title editing through EditorSession', () => {
  it('double-click edits a local draft and Enter commits exactly one undoable update', () => {
    const dispatch = vi.spyOn(History.prototype, 'dispatch');
    const state = renderEditor();
    const input = openTitle();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(state().editing).toEqual({ id: 'a', created: false });
    draft(input, '新想法');
    expect(state().map).toBe(MAP);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch.mock.calls.map(([, op]) => op)).toEqual([
      { op: 'update_node', id: 'a', text: '新想法' },
    ]);
    expectOneRename(state, 'a', '新想法');
    expect(screen.getByTestId('editor-title').textContent).toBe('导图标题');
    expect(nodeWrapper('b').textContent).toBe('B');
    dispatch.mockRestore();
  });

  it.each(['Enter', 'Escape'])(
    '%s followed by blur terminates only once and restores canvas focus',
    (key) => {
      const dispatch = vi.spyOn(History.prototype, 'dispatch');
      const state = renderEditor();
      const input = openTitle();
      draft(input, '一次改名');
      act(() => {
        fireEvent.keyDown(input, { key });
        fireEvent.blur(input);
      });
      expect(state().editing).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('region'));
      expect(screen.queryByLabelText('节点标题')).toBeNull();
      if (key === 'Enter') {
        expect(dispatch.mock.calls.map(([, op]) => op)).toEqual([
          { op: 'update_node', id: 'a', text: '一次改名' },
        ]);
        expectOneRename(state, 'a', '一次改名');
      } else {
        expect(dispatch).not.toHaveBeenCalled();
        expect(state().map).toBe(MAP);
        expect(state().canUndo).toBe(false);
      }
      dispatch.mockRestore();
    },
  );

  it('blur commits once without stealing destination focus', () => {
    const dispatch = vi.spyOn(History.prototype, 'dispatch');
    const state = renderEditor();
    const input = openTitle();
    draft(input, '失焦改名');
    const destination = screen.getByRole('button', { name: '目的地' });
    act(() => {
      destination.focus();
    });
    expect(document.activeElement).toBe(destination);
    expect(dispatch.mock.calls.map(([, op]) => op)).toEqual([
      { op: 'update_node', id: 'a', text: '失焦改名' },
    ]);
    expectOneRename(state, 'a', '失焦改名');
    dispatch.mockRestore();
  });

  it('F2 renames only the primary of three selected nodes without changing selection', () => {
    const state = renderEditor();
    const region = screen.getByRole('region');
    fireEvent.keyDown(region, { key: 'F2' });
    expect(state().editing).toBeNull();
    fireEvent.click(nodeWrapper('a'));
    fireEvent.click(nodeWrapper('b'), { shiftKey: true });
    fireEvent.click(nodeWrapper('c'), { shiftKey: true });
    const selected = state().selectedIds;
    fireEvent.keyDown(region, { key: 'F2' });
    expect(state().editing).toEqual({ id: 'c', created: false });
    expect(state().selectedIds).toBe(selected);
    expect(state().primaryId).toBe('c');
    expect(screen.getAllByLabelText('节点标题')).toHaveLength(1);
    const input = screen.getByLabelText<HTMLInputElement>('节点标题');
    expect(nodeWrapper('c').contains(input)).toBe(true);
    draft(input, '主选改名');
    fireEvent.keyDown(input, { key: 'Enter' });
    expectOneRename(state, 'c', '主选改名');
    expect(state().selectedIds).toEqual(['a', 'b', 'c']);
    expect(state().primaryId).toBe('c');
    expect(nodeWrapper('a').textContent).toBe('A');
    expect(nodeWrapper('b').textContent).toBe('B');
  });

  it.each(['Enter', 'Escape'])(
    'composing %s stays native and does not terminate editing',
    (key) => {
      const state = renderEditor();
      const input = openTitle();
      draft(input, '输入法草稿');
      fireEvent.compositionStart(input);
      expect(fireEvent.keyDown(input, { key })).toBe(true);
      expect(state().editing?.id).toBe('a');
      expect(state().map).toBe(MAP);
      fireEvent.compositionEnd(input);
      expect(fireEvent.keyDown(input, { key, isComposing: true })).toBe(true);
      expect(state().editing?.id).toBe('a');
      fireEvent.keyDown(input, { key: 'Enter' });
      expectOneRename(state, 'a', '输入法草稿');
    },
  );

  it.each(['hidden', 'deleted'])(
    '%s rename target closes without stale blur touching another edit',
    (change) => {
      const state = renderEditor();
      const input = openTitle();
      draft(input, '过期草稿');
      act(() => {
        state().dispatch(
          change === 'hidden'
            ? { op: 'update_node', id: 'r', collapsed: true }
            : { op: 'delete_node', id: 'a' },
        );
        fireEvent.blur(input);
      });
      expect(state().editing).toBeNull();
      expect(screen.queryByLabelText('节点标题')).toBeNull();
      const replacement = openTitle('r');
      draft(replacement, '有效草稿');
      fireEvent.blur(input);
      expect(state().editing).toEqual({ id: 'r', created: false });
      expect(replacement.value).toBe('有效草稿');
      fireEvent.keyDown(replacement, { key: 'Escape' });
      act(() => {
        state().undo();
      });
      expect(state().map).toEqual(MAP);
      expect(state().canUndo).toBe(false);
    },
  );

  it('hidden input cancels even when removal delivers no blur', () => {
    const state = renderEditor();
    draft(openTitle(), '不应保存');
    act(() => {
      state().dispatch({ op: 'update_node', id: 'r', collapsed: true });
    });
    expect(state().editing).toBeNull();
    expect(screen.queryByLabelText('节点标题')).toBeNull();
    act(() => {
      state().undo();
    });
    expect(state().map).toEqual(MAP);
    expect(state().canUndo).toBe(false);
  });

  it('same-event replacement edit ignores the previous input blur', () => {
    const state = renderEditor();
    const oldInput = openTitle();
    draft(oldInput, '旧草稿');
    act(() => {
      state().cancelEdit();
      state().startEdit('b');
      fireEvent.blur(oldInput);
    });
    expect(state().editing).toEqual({ id: 'b', created: false });
    expect(state().map).toBe(MAP);
    const input = screen.getByLabelText<HTMLInputElement>('节点标题');
    expect(input.value).toBe('B');
    draft(input, '新草稿');
    fireEvent.keyDown(input, { key: 'Enter' });
    expectOneRename(state, 'b', '新草稿');
  });

  it.each(['', '   ', 'A'])('committing %j is an existing-title no-op', (text) => {
    const dispatch = vi.spyOn(History.prototype, 'dispatch');
    const state = renderEditor();
    const input = openTitle();
    draft(input, text);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(state().map).toBe(MAP);
    expect(state().canUndo).toBe(false);
    expect(state().editing).toBeNull();
    expect(nodeWrapper('a').textContent).toBe('A');
  });

  it('accepts all 200 characters verbatim without a maxlength', () => {
    const state = renderEditor();
    const text = `  ${'长'.repeat(196)}  `;
    expect(text).toHaveLength(200);
    const input = openTitle();
    expect(input.hasAttribute('maxlength')).toBe(false);
    expect(input.type).toBe('text');
    draft(input, text);
    fireEvent.keyDown(input, { key: 'Enter' });
    expectOneRename(state, 'a', text);
  });

  it('text-field keys stay native without selecting, navigating or panning the canvas', () => {
    const state = renderEditor();
    fireEvent.click(nodeWrapper('c'));
    const input = openTitle('a');
    const before = state();
    for (const key of [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Tab',
      'Backspace',
      'Delete',
      ' ',
      'F2',
      'a',
      'z',
    ]) {
      expect(fireEvent.keyDown(input, { key, ctrlKey: key === 'a' || key === 'z' })).toBe(true);
      fireEvent.keyUp(input, { key });
      expect(state()).toBe(before);
    }
    expect(fireEvent.keyDown(input, { key: 'a', metaKey: true })).toBe(true);
    fireEvent.click(nodeWrapper('b'));
    fireEvent.doubleClick(nodeWrapper('b'));
    expect(state()).toBe(before);
    draft(input, '原生输入含 空格');
    fireEvent.keyDown(input, { key: 'Enter' });
    expectOneRename(state, 'a', '原生输入含 空格');
    expect(state().selectedIds).toEqual(['c']);
  });

  it('F2 ignores modifiers, composition and an external active text field', () => {
    const state = renderEditor();
    fireEvent.click(nodeWrapper('a'));
    const region = screen.getByRole('region');
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      expect(fireEvent.keyDown(region, { key: 'F2', [modifier]: true })).toBe(true);
      expect(state().editing).toBeNull();
    }
    fireEvent.compositionStart(region);
    fireEvent.keyDown(region, { key: 'F2' });
    expect(state().editing).toBeNull();
    fireEvent.compositionEnd(region);
    fireEvent.keyDown(region, { key: 'F2', isComposing: true });
    expect(state().editing).toBeNull();
    const external = document.createElement('textarea');
    document.body.append(external);
    external.focus();
    fireEvent.keyDown(region, { key: 'F2' });
    expect(state().editing).toBeNull();
    external.remove();
  });
});
