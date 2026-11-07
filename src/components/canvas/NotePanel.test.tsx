import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import {
  borderBoxEntry,
  canvasObserverOf,
  failOnConsoleNoise,
  installControllableResizeObservers,
  mindNodeElement,
  nodeWrapper,
  reactFlowNodeObserverOf,
  sizedWrapperEntry,
} from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { EditorSession, selectMap, useEditorStoreApi } from '../editor/EditorSession';
import { EditorView } from '../editor/EditorView';

failOnConsoleNoise();
const observers = installControllableResizeObservers();

function setup(original = mapOf(node('r', [node('a'), node('b', [], { note: '保留备注' })]))) {
  let store: StoreApi<EditorState> | undefined;
  function Probe() {
    store = useEditorStoreApi();
    return null;
  }
  const state = () => {
    if (store === undefined) throw new Error('missing editor session');
    return store.getState();
  };
  render(
    <EditorSession map={original} repository={new RecordingRepository()}>
      <Probe />
      <EditorView />
    </EditorSession>,
  );
  const measured = ['r', 'a', 'b'];
  canvasObserverOf(observers()).fire(
    measured.map((id) => borderBoxEntry(mindNodeElement(id), 100, 32)),
  );
  reactFlowNodeObserverOf(observers()).fire(measured.map((id) => sizedWrapperEntry(id, 100, 32)));
  return { original, state };
}

function noteField() {
  return screen.getByRole<HTMLTextAreaElement>('textbox', { name: '节点备注' });
}

describe('NotePanel through EditorSession', () => {
  it('keeps a two-line note draft local until blur and restores note absence with one undo', () => {
    const { original, state } = setup();

    fireEvent.click(nodeWrapper('a'));
    expect(state().selectedIds).toEqual(['a']);
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '节点备注' });
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.value).toBe('');
    expect(within(nodeWrapper('a')).queryByRole('img', { name: '有备注' })).toBeNull();
    const undo = screen.getByRole<HTMLButtonElement>('button', { name: '撤销' });
    expect(undo.disabled).toBe(true);
    expect(state().canUndo).toBe(false);

    act(() => {
      input.focus();
    });
    fireEvent.change(input, { target: { value: '第一行 **原样**' } });
    expect(selectMap(state())).toStrictEqual(original);
    fireEvent.change(input, { target: { value: '第一行 **原样**\n第二行 <原样>' } });
    expect(input.value).toBe('第一行 **原样**\n第二行 <原样>');
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
    expect(undo.disabled).toBe(true);
    expect(within(nodeWrapper('a')).queryByRole('img', { name: '有备注' })).toBeNull();

    act(() => {
      input.blur();
    });
    expect(selectMap(state())).toStrictEqual(
      mapOf(
        node('r', [
          node('a', [], { note: '第一行 **原样**\n第二行 <原样>' }),
          node('b', [], { note: '保留备注' }),
        ]),
      ),
    );
    expect(within(nodeWrapper('a')).getByRole('img', { name: '有备注' })).not.toBeNull();
    expect(state().canUndo).toBe(true);
    expect(state().groupOpen).toBe(false);
    expect(undo.disabled).toBe(false);

    fireEvent.click(undo);
    expect(selectMap(state())).toStrictEqual(original);
    expect(within(nodeWrapper('a')).queryByRole('img', { name: '有备注' })).toBeNull();
    expect(state().canUndo).toBe(false);
    expect(state().canRedo).toBe(true);
    expect(undo.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重做' }).disabled).toBe(false);
  });

  it('编辑备注 focuses an unselected right-click target and refocuses its existing note field', () => {
    const { original, state } = setup();
    const canvas = screen.getByRole('region');
    act(() => {
      canvas.focus();
    });
    fireEvent.click(nodeWrapper('r'));
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '节点备注' }).value).toBe('');
    expect(document.activeElement).toBe(canvas);
    fireEvent.click(nodeWrapper('a'), { shiftKey: true });
    expect(state().selectedIds).toEqual(['r', 'a']);
    expect(screen.queryByRole('textbox', { name: '节点备注' })).toBeNull();

    fireEvent.contextMenu(nodeWrapper('b'), { clientX: 130, clientY: 100 });
    expect(state().selectedIds).toEqual(['r', 'a']);
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
    expect(state().canRedo).toBe(false);
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑备注' }));

    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '节点备注' });
    expect(state().selectedIds).toEqual(['b']);
    expect(state().primaryId).toBe('b');
    expect(input.value).toBe('保留备注');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
    expect(state().canRedo).toBe(false);
    expect(state().groupOpen).toBe(false);

    act(() => {
      canvas.focus();
    });
    expect(document.activeElement).toBe(canvas);
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
    expect(state().canRedo).toBe(false);
    fireEvent.contextMenu(nodeWrapper('b'), { clientX: 130, clientY: 100 });
    expect(state().selectedIds).toEqual(['b']);
    expect(screen.getByRole('textbox', { name: '节点备注' })).toBe(input);
    expect(document.activeElement).not.toBe(input);
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑备注' }));

    expect(screen.getByRole('textbox', { name: '节点备注' })).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('保留备注');
    expect(state().selectedIds).toEqual(['b']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
    expect(state().canRedo).toBe(false);
    expect(state().groupOpen).toBe(false);
  });

  it('discards a stale dirty draft when load replaces the map with the same node id and note', () => {
    const { original, state } = setup(
      mapOf(node('r', [node('a', [], { note: '相同备注' }), node('b')])),
    );
    const replacement = {
      ...mapOf(node('r', [node('a', [], { text: '第二张图的节点', note: '相同备注' }), node('b')])),
      id: 'm2',
      title: '第二张导图',
    };
    fireEvent.click(nodeWrapper('a'));
    const oldInput = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '节点备注' });
    expect(oldInput.value).toBe('相同备注');
    act(() => {
      oldInput.focus();
    });
    fireEvent.change(oldInput, { target: { value: '只属于第一张图的未提交草稿' } });
    expect(document.activeElement).toBe(oldInput);
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);

    act(() => {
      state().load(replacement);
      state().select('a');
      oldInput.blur();
    });

    expect(selectMap(state())).toStrictEqual(replacement);
    expect(state().selectedIds).toEqual(['a']);
    expect(state().canUndo).toBe(false);
    expect(state().canRedo).toBe(false);
    expect(state().groupOpen).toBe(false);
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '节点备注' }).value).toBe(
      '相同备注',
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '撤销' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重做' }).disabled).toBe(true);
  });

  it('shows a note only for one selected node without adding another canvas region', () => {
    const { original, state } = setup();
    expect(screen.queryByRole('textbox', { name: '节点备注' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: '备注' })).toBeNull();
    fireEvent.click(nodeWrapper('b'));
    expect(noteField().value).toBe('保留备注');
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByRole('complementary', { name: '备注' })).not.toBeNull();
    expect(document.activeElement).not.toBe(noteField());
    fireEvent.click(nodeWrapper('a'), { shiftKey: true });
    expect(screen.queryByRole('textbox', { name: '节点备注' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: '备注' })).toBeNull();
    fireEvent.click(nodeWrapper('a'), { shiftKey: true });
    expect(noteField().value).toBe('保留备注');
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: '节点备注' })).toBeNull();
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
  });

  it('clears an existing note to absence with one exact undo and redo', () => {
    const { original, state } = setup();
    const cleared = mapOf(node('r', [node('a'), node('b')]));
    fireEvent.click(nodeWrapper('b'));
    const input = noteField();
    act(() => {
      input.focus();
    });
    fireEvent.change(input, { target: { value: '' } });
    expect(selectMap(state())).toStrictEqual(original);
    act(() => {
      input.blur();
    });
    expect(selectMap(state())).toStrictEqual(cleared);
    expect(within(nodeWrapper('b')).queryByRole('img', { name: '有备注' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(selectMap(state())).toStrictEqual(original);
    expect(noteField().value).toBe('保留备注');
    expect(within(nodeWrapper('b')).getByRole('img', { name: '有备注' })).not.toBeNull();
    expect(state().canUndo).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(selectMap(state())).toStrictEqual(cleared);
    expect(noteField().value).toBe('');
    expect(within(nodeWrapper('b')).queryByRole('img', { name: '有备注' })).toBeNull();
    expect(state().canRedo).toBe(false);
  });

  it('ignores unchanged and duplicate blur but allows a later edit to create its own undo step', () => {
    const { original, state } = setup();
    const first = mapOf(node('r', [node('a'), node('b', [], { note: '第一版' })]));
    const second = mapOf(node('r', [node('a'), node('b', [], { note: '  第二版\n ' })]));
    fireEvent.click(nodeWrapper('b'));
    const input = noteField();
    act(() => {
      input.focus();
      input.blur();
    });
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
    act(() => {
      input.focus();
    });
    fireEvent.change(input, { target: { value: '第一版' } });
    act(() => {
      input.blur();
      fireEvent.blur(input);
    });
    expect(selectMap(state())).toStrictEqual(first);
    act(() => {
      input.focus();
    });
    fireEvent.change(input, { target: { value: '  第二版\n ' } });
    act(() => {
      input.blur();
    });
    fireEvent.blur(input);
    expect(selectMap(state())).toStrictEqual(second);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(selectMap(state())).toStrictEqual(first);
    act(() => {
      input.focus();
      input.blur();
    });
    expect(state().canRedo).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
  });

  it('discards an outgoing draft when selection is replaced before its stale blur', () => {
    const { original, state } = setup();
    fireEvent.click(nodeWrapper('a'));
    const oldInput = noteField();
    act(() => {
      oldInput.focus();
    });
    fireEvent.change(oldInput, { target: { value: '不属于下一次选择' } });
    act(() => {
      state().select('b');
      oldInput.blur();
    });
    expect(state().selectedIds).toEqual(['b']);
    expect(noteField().value).toBe('保留备注');
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
    fireEvent.blur(oldInput);
    expect(selectMap(state())).toStrictEqual(original);
  });

  it.each(['before render', 'after render'])(
    'reflects an external note update instead of committing stale local text %s',
    (timing) => {
      const { original, state } = setup();
      const refreshed = mapOf(
        node('r', [node('a', [], { note: '外部备注' }), node('b', [], { note: '保留备注' })]),
      );
      fireEvent.click(nodeWrapper('a'));
      const input = noteField();
      act(() => {
        input.focus();
      });
      fireEvent.change(input, { target: { value: '过期草稿' } });
      act(() => {
        state().dispatch({ op: 'update_node', id: 'a', note: '外部备注' });
        if (timing === 'before render') input.blur();
      });
      expect(noteField().value).toBe('外部备注');
      if (timing === 'after render') {
        act(() => {
          input.blur();
        });
      }
      expect(selectMap(state())).toStrictEqual(refreshed);
      fireEvent.click(screen.getByRole('button', { name: '撤销' }));
      expect(selectMap(state())).toStrictEqual(original);
      expect(noteField().value).toBe('');
      expect(state().canUndo).toBe(false);
    },
  );

  it.each([false, true])(
    'refuses a stale blur after its target is removed (replacement=%s)',
    (replace) => {
      const { original, state } = setup();
      const removed = mapOf(node('r', [node('b', [], { note: '保留备注' })]));
      const replaced = mapOf(
        node('r', [node('b', [], { note: '保留备注' }), node('a', [], { text: '替代节点' })]),
      );
      fireEvent.click(nodeWrapper('a'));
      const input = noteField();
      act(() => {
        input.focus();
      });
      fireEvent.change(input, { target: { value: '已删除节点的草稿' } });
      act(() => {
        state().dispatch({ op: 'delete_node', id: 'a' });
        if (replace) {
          state().dispatch({
            op: 'add_children',
            parentId: 'r',
            children: [{ id: 'a', text: '替代节点' }],
          });
          state().select('a');
        }
        input.blur();
      });
      expect(selectMap(state())).toStrictEqual(replace ? replaced : removed);
      if (replace) {
        expect(noteField().value).toBe('');
        fireEvent.click(screen.getByRole('button', { name: '撤销' }));
        expect(selectMap(state())).toStrictEqual(removed);
      } else expect(screen.queryByRole('textbox', { name: '节点备注' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '撤销' }));
      expect(selectMap(state())).toStrictEqual(original);
      expect(state().canUndo).toBe(false);
    },
  );

  it('consumes menu focus requests without replaying them on selection or a replacement map', () => {
    const { original, state } = setup();
    const canvas = screen.getByRole('region');
    fireEvent.contextMenu(nodeWrapper('b'));
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑备注' }));
    expect(document.activeElement).toBe(noteField());
    act(() => {
      canvas.focus();
    });
    fireEvent.click(nodeWrapper('a'));
    fireEvent.click(nodeWrapper('b'));
    expect(document.activeElement).toBe(canvas);
    expect(noteField().value).toBe('保留备注');
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);

    const replacement = {
      ...mapOf(node('r', [node('a'), node('b', [], { note: '另一张图' })])),
      id: 'm2',
      title: '新的导图',
    };
    fireEvent.contextMenu(nodeWrapper('b'));
    const editNote = screen.getByRole<HTMLButtonElement>('menuitem', { name: '编辑备注' });
    act(() => {
      editNote.click();
      state().load(replacement);
      state().select('b');
    });
    expect(noteField().value).toBe('另一张图');
    expect(document.activeElement).not.toBe(noteField());
    expect(selectMap(state())).toStrictEqual(replacement);
    expect(state().canUndo).toBe(false);
    expect(state().canRedo).toBe(false);
    fireEvent.click(nodeWrapper('a'));
    fireEvent.click(nodeWrapper('b'));
    expect(document.activeElement).not.toBe(noteField());
  });

  it.each(['rename', 'create'])('does not steal the inline title focus during %s', (operation) => {
    const { original, state } = setup();
    fireEvent.click(nodeWrapper('a'));
    if (operation === 'rename') fireEvent.doubleClick(nodeWrapper('a'));
    else fireEvent.keyDown(screen.getByRole('region'), { key: 'Tab' });
    const editingId = state().editing?.id;
    if (editingId === undefined) throw new Error('missing title editing target');
    if (operation === 'create') {
      canvasObserverOf(observers()).fire([borderBoxEntry(mindNodeElement(editingId), 100, 32)]);
      reactFlowNodeObserverOf(observers()).fire([sizedWrapperEntry(editingId, 100, 32)]);
    }
    expect(noteField().value).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '节点标题' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: '节点标题' }), { key: 'Escape' });
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
  });

  it('leaves textarea editing keys native without changing selection, map or history', () => {
    const { original, state } = setup();
    act(() => {
      state().dispatch({ op: 'update_node', id: 'b', text: '先前的改名' });
    });
    const renamed = mapOf(
      node('r', [node('a'), node('b', [], { text: '先前的改名', note: '保留备注' })]),
    );
    fireEvent.click(nodeWrapper('a'));
    const input = noteField();
    act(() => {
      input.focus();
    });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '输入中的文字' } });
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
    fireEvent.compositionEnd(input);
    for (const event of [
      { key: 'Enter' },
      { key: 'Tab' },
      { key: 'Delete' },
      { key: 'Backspace' },
      { key: 'ArrowLeft' },
      { key: 'ArrowRight' },
      { key: 'ArrowUp' },
      { key: 'ArrowDown' },
      { key: 'Escape' },
      { key: 'F2' },
      { key: ' ' },
      { key: 'a', ctrlKey: true },
      { key: 'a', metaKey: true },
      { key: 'z', ctrlKey: true },
      { key: 'z', metaKey: true },
      { key: 'z', ctrlKey: true, shiftKey: true },
      { key: 'z', metaKey: true, shiftKey: true },
    ]) {
      expect(fireEvent.keyDown(input, event)).toBe(true);
      fireEvent.keyUp(input, event);
      expect(state().selectedIds).toEqual(['a']);
      expect(state().editing).toBeNull();
      expect(selectMap(state())).toStrictEqual(renamed);
      expect(state().canUndo).toBe(true);
      expect(state().canRedo).toBe(false);
    }
    fireEvent.change(input, { target: { value: '' } });
    act(() => {
      input.blur();
    });
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(selectMap(state())).toStrictEqual(original);
    expect(state().canUndo).toBe(false);
  });
});
