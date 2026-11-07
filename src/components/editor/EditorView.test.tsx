import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { failOnConsoleNoise, nodeWrapper } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import { StorageUnavailableError } from '../../contexts/map/domain/errors';
import { EditorSession, selectMap, useEditorStoreApi } from './EditorSession';
import { EditorView } from './EditorView';

// Design "Fixture — issue #16": the editor's header, canvas area and ready marker, rendered inside
// a real EditorSession; the canvas is the unmocked MindMapCanvas.

failOnConsoleNoise();
afterEach(() => {
  vi.useRealTimers();
});

// The title and the primary root text differ, so the header cannot pass by showing the root.
const MAP = { ...mapOf(node('r', [node('a')], { text: '根节点B' })), title: '标题A' };

describe('EditorView', () => {
  it('shows the map title in the header, the ready marker and the canvas', () => {
    render(
      <EditorSession map={MAP} repository={new RecordingRepository()}>
        <EditorView />
      </EditorSession>,
    );

    expect(screen.getByTestId('editor-title').textContent).toBe('标题A');
    expect(screen.getByTestId('map-editor-ready').contains(nodeWrapper('r'))).toBe(true);
    expect(nodeWrapper('r').textContent).toBe('根节点B');
  });

  it('projects click and Shift toggle selection and routes canvas keys to the session', () => {
    render(
      <EditorSession map={MAP} repository={new RecordingRepository()}>
        <EditorView />
      </EditorSession>,
    );
    fireEvent.click(nodeWrapper('r'));
    expect(nodeWrapper('r').querySelector('[aria-pressed="true"]')).not.toBeNull();
    fireEvent.click(nodeWrapper('a'), { shiftKey: true });
    expect(nodeWrapper('r').querySelector('[aria-pressed="true"]')).not.toBeNull();
    expect(nodeWrapper('a').querySelector('[aria-pressed="true"]')).not.toBeNull();
    fireEvent.click(nodeWrapper('a'), { shiftKey: true });
    expect(nodeWrapper('a').querySelector('[aria-pressed="true"]')).toBeNull();
    fireEvent.keyDown(nodeWrapper('r'), { key: 'ArrowRight' });
    expect(nodeWrapper('a').querySelector('[aria-pressed="true"]')).not.toBeNull();
    expect(nodeWrapper('r').querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it.each([false, true])(
    'shows one persistent banner after an unavailable put (provider=%s)',
    async (providerUnavailable) => {
      const repository = new RecordingRepository();
      repository.rejectNext(new StorageUnavailableError('connection unavailable'));
      let store: StoreApi<EditorState> | undefined;
      function Probe() {
        store = useEditorStoreApi();
        return null;
      }
      render(
        <EditorSession map={MAP} repository={repository}>
          <Probe />
          <EditorView storageUnavailable={providerUnavailable} />
        </EditorSession>,
      );
      fireEvent.doubleClick(nodeWrapper('a'));
      fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '会话中的改名' } });
      fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Enter' });
      await act(async () => {
        await store?.getState().flush();
      });
      expect(screen.getAllByText('未保存到浏览器')).toHaveLength(1);
      expect(screen.queryByText('保存失败')).toBeNull();
      expect(nodeWrapper('a').textContent).toBe('会话中的改名');
      expect(repository.puts).toHaveLength(1);
      act(() => {
        store?.getState().startEdit('a');
        store?.getState().commitTitle('仍用原仓库');
      });
      await act(async () => {
        await store?.getState().flush();
      });
      expect(repository.puts).toHaveLength(2);
      expect(repository.puts[1]?.roots[0]?.children[0]?.text).toBe('仍用原仓库');
      expect(screen.getAllByText('未保存到浏览器')).toHaveLength(1);
    },
  );

  it('keeps a failed rename, renders the current store notice and clears it only on dismiss', async () => {
    vi.useFakeTimers();
    const repository = new RecordingRepository();
    repository.rejectNext(new DOMException('quota', 'QuotaExceededError'));
    let store: StoreApi<EditorState> | undefined;
    function Probe() {
      store = useEditorStoreApi();
      return null;
    }
    render(
      <EditorSession map={MAP} repository={repository}>
        <Probe />
        <EditorView />
      </EditorSession>,
    );
    fireEvent.doubleClick(nodeWrapper('a'));
    fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '未丢失的文字' } });
    fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Enter' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole('alert').textContent).toContain('保存失败');
    expect(nodeWrapper('a').textContent).toBe('未丢失的文字');
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
    act(() => {
      store?.getState().showNotice('主根不能删除');
    });
    expect(screen.getByRole('alert').textContent).toContain('主根不能删除');
    expect(screen.queryByText('保存失败')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(store?.getState().notice).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(nodeWrapper('a').textContent).toBe('未丢失的文字');
  });
});

function creationEditor() {
  let store: StoreApi<EditorState> | undefined;
  const repository = new RecordingRepository();
  function Probe() {
    store = useEditorStoreApi();
    return null;
  }
  const map = mapOf(
    node('r', [node('a'), node('b', [node('h1'), node('h2')], { collapsed: true }), node('c')]),
    node('f', [], { position: { x: 700, y: 200 } }),
  );
  render(
    <EditorSession map={map} repository={repository}>
      <Probe />
      <EditorView />
      <button type="button">目的地</button>
    </EditorSession>,
  );
  const state = () => {
    if (store === undefined) throw new Error('missing editor session');
    return store.getState();
  };
  return { state, repository, map };
}

function priorRename() {
  fireEvent.doubleClick(nodeWrapper('a'));
  fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '保留的改名' } });
  fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Enter' });
}

function createFrom(id: string, key = 'Tab'): HTMLInputElement {
  fireEvent.click(nodeWrapper(id));
  fireEvent.keyDown(screen.getByRole('region'), { key });
  return screen.getByLabelText('节点标题');
}

describe('keyboard creation through EditorSession', () => {
  it('Tab appends a selected child and focuses the existing title input', () => {
    const { state } = creationEditor();
    fireEvent.click(nodeWrapper('r'));
    expect(fireEvent.keyDown(screen.getByRole('region'), { key: 'Tab' })).toBe(false);
    const input = screen.getByLabelText<HTMLInputElement>('节点标题');
    const id = state().editing?.id;
    expect(id).toBeTypeOf('string');
    expect(state().editing).toEqual({ id, created: true });
    expect(state().selectedIds).toEqual([id]);
    expect(selectMap(state()).roots[0]?.children.map((child) => child.id)).toEqual([
      'a',
      'b',
      'c',
      id,
    ]);
    expect(state().groupOpen).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(0);
  });

  it.each(['b', 'r', 'f'])('Enter creates the next sibling or root child from %s', (selected) => {
    const { state } = creationEditor();
    fireEvent.click(nodeWrapper(selected));
    expect(fireEvent.keyDown(screen.getByRole('region'), { key: 'Enter' })).toBe(false);
    const id = state().editing?.id;
    const roots = selectMap(state()).roots;
    expect(roots.map((root) => root.id)).toEqual(['r', 'f']);
    expect(roots[1]?.position).toEqual({ x: 700, y: 200 });
    const expected = selected === 'b' ? ['a', 'b', id, 'c'] : ['a', 'b', 'c', id];
    expect(roots[0]?.children.map((child) => child.id)).toEqual(
      selected === 'f' ? ['a', 'b', 'c'] : expected,
    );
    expect(roots[1]?.children.map((child) => child.id)).toEqual(selected === 'f' ? [id] : []);
    expect(document.activeElement).toBe(screen.getByLabelText('节点标题'));
    expect(state().selectedIds).toEqual([id]);
  });

  it.each(['Enter', 'blur'])(
    'names the collapsed parent third child with one group via %s',
    (end) => {
      const { state } = creationEditor();
      priorRename();
      const before = selectMap(state());
      const input = createFrom('b');
      const id = state().editing?.id;
      expect(document.activeElement).toBe(input);
      expect(selectMap(state()).roots[0]?.children[1]).toMatchObject({
        children: [{ id: 'h1' }, { id: 'h2' }, { id, text: '' }],
      });
      expect(screen.queryByLabelText('已折叠 2 个节点')).toBeNull();
      expect(nodeWrapper('h1').textContent).toBe('H1');
      expect(nodeWrapper('h2').textContent).toBe('H2');
      const text = `  想法${'长'.repeat(200)}  `;
      fireEvent.change(input, { target: { value: text } });
      act(() => {
        if (end === 'Enter') fireEvent.keyDown(input, { key: 'Enter' });
        else screen.getByRole('button', { name: '目的地' }).focus();
        fireEvent.blur(input);
      });
      expect(state().editing).toBeNull();
      expect(state().groupOpen).toBe(false);
      expect(state().selectedIds).toEqual([id]);
      const named = selectMap(state());
      expect(named.roots[0]?.children[1]?.children).toEqual([
        node('h1'),
        node('h2'),
        { id, text, children: [] },
      ]);
      act(() => {
        state().undo();
      });
      expect(selectMap(state())).toEqual(before);
      expect(state().selectedIds).toEqual([]);
      expect(state().primaryId).toBeNull();
      expect(state().canUndo).toBe(true);
      expect(state().canRedo).toBe(true);
      act(() => {
        state().redo();
      });
      expect(selectMap(state())).toEqual(named);
      expect(state().canRedo).toBe(false);
      expect(screen.queryByLabelText('节点标题')).toBeNull();
    },
  );

  it.each([
    ['Enter', ''],
    ['Enter', ' \t '],
    ['Escape', '未提交'],
    ['blur', ''],
    ['blur', '   '],
  ])('%s cancels unnamed creation %j without consuming prior history', (end, text) => {
    const { state, map } = creationEditor();
    priorRename();
    const before = selectMap(state());
    const input = createFrom('b');
    expect(state().groupOpen).toBe(true);
    fireEvent.change(input, { target: { value: text } });
    act(() => {
      if (end === 'blur') screen.getByRole('button', { name: '目的地' }).focus();
      else fireEvent.keyDown(input, { key: end });
      fireEvent.blur(input);
    });
    expect(selectMap(state())).toEqual(before);
    expect(state().selectedIds).toEqual(['b']);
    expect(state().primaryId).toBe('b');
    expect(state().groupOpen).toBe(false);
    expect(state().editing).toBeNull();
    expect(state().canUndo).toBe(true);
    expect(state().canRedo).toBe(false);
    expect(screen.queryByLabelText('节点标题')).toBeNull();
    act(() => {
      state().undo();
    });
    expect(selectMap(state())).toEqual(map);
    expect(state().canUndo).toBe(false);
  });

  it.each(['cancel', 'name'])(
    'keeps provisional nodes and expansion out of every put before %s',
    async (end) => {
      vi.useFakeTimers();
      const { state, repository } = creationEditor();
      priorRename();
      const stable = selectMap(state());
      const input = createFrom('b');
      fireEvent.change(input, { target: { value: '草稿' } });
      fireEvent(window, new Event('pagehide'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(repository.puts).toHaveLength(1);
      expect(repository.puts[0]?.roots).toEqual(stable.roots);
      fireEvent.keyDown(input, { key: end === 'cancel' ? 'Escape' : 'Enter' });
      fireEvent(window, new Event('pagehide'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      if (end === 'cancel') {
        for (const saved of repository.puts) expect(saved.roots).toEqual(stable.roots);
      } else {
        expect(repository.puts.at(-1)?.roots).toEqual(selectMap(state()).roots);
        expect(repository.puts.at(-1)?.roots[0]?.children[1]?.children[2]?.text).toBe('草稿');
      }
      expect(
        repository.puts.every((map) =>
          map.roots[0]?.children[1]?.children.every((child) => child.text !== ''),
        ),
      ).toBe(true);
    },
  );

  it.each(['Tab', 'Enter'])('leaves native %s alone without exactly one selection', (key) => {
    const { state } = creationEditor();
    const region = screen.getByRole('region');
    expect(fireEvent.keyDown(region, { key })).toBe(true);
    fireEvent.click(nodeWrapper('a'));
    fireEvent.click(nodeWrapper('b'), { shiftKey: true });
    const before = state();
    expect(fireEvent.keyDown(region, { key })).toBe(true);
    expect(state()).toBe(before);
    expect(screen.queryByLabelText('节点标题')).toBeNull();
  });

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'repeat', 'isComposing'])(
    'ignores creation with %s without preventing defaults',
    (flag) => {
      const { state } = creationEditor();
      fireEvent.click(nodeWrapper('a'));
      const before = state();
      for (const key of ['Tab', 'Enter']) {
        expect(fireEvent.keyDown(screen.getByRole('region'), { key, [flag]: true })).toBe(true);
        expect(state()).toBe(before);
      }
    },
  );

  it('does not create on WebKit composition-ending Enter', () => {
    const { state } = creationEditor();
    fireEvent.click(nodeWrapper('a'));
    const before = state();
    expect(fireEvent.keyDown(screen.getByRole('region'), { key: 'Enter', keyCode: 229 })).toBe(
      true,
    );
    expect(state()).toBe(before);
  });

  it('blocks the canvas composition lifecycle until composition ends', () => {
    const { state } = creationEditor();
    fireEvent.click(nodeWrapper('a'));
    const region = screen.getByRole('region');
    const before = state();
    fireEvent.compositionStart(region);
    expect(fireEvent.keyDown(region, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(region, { key: 'Tab' })).toBe(true);
    expect(state()).toBe(before);
    fireEvent.compositionEnd(region);
    expect(fireEvent.keyDown(region, { key: 'Tab' })).toBe(false);
    expect(screen.getByLabelText('节点标题')).toBe(document.activeElement);
  });

  it.each(['input', 'textarea', 'select', 'div'])('retains native keys in focused %s', (tag) => {
    const { state } = creationEditor();
    fireEvent.click(nodeWrapper('a'));
    const region = screen.getByRole('region');
    const field = document.createElement(tag);
    field.tabIndex = 0;
    if (tag === 'div') field.setAttribute('contenteditable', 'true');
    region.append(field);
    const target = tag === 'div' ? field.appendChild(document.createElement('span')) : field;
    const before = state();
    for (const key of ['Tab', 'Enter']) {
      expect(fireEvent.keyDown(target, { key })).toBe(true);
      field.focus();
      expect(fireEvent.keyDown(region, { key })).toBe(true);
      field.blur();
      expect(state()).toBe(before);
    }
    field.remove();
  });

  it('keeps Tab native and IME Enter nonterminal in the new input', () => {
    const { state } = creationEditor();
    const input = createFrom('b');
    const before = state();
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
    expect(state()).toBe(before);
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: '组合完成' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state().editing).toBeNull();
    expect(selectMap(state()).roots[0]?.children[1]?.children).toHaveLength(3);
  });
});
