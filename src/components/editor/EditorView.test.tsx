import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { failOnConsoleNoise, nodeWrapper } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { httpRepository, MapFetch } from '../../../tests/support/map-fetch';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
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
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '撤销' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重做' }).disabled).toBe(true);
    expect(screen.queryByRole('link', { name: '重新登录' })).toBeNull();
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

  it('keeps a renamed canvas node after session expiry and offers re-login in a new tab', async () => {
    vi.useFakeTimers();
    const server = new MapFetch();
    server.respondNext(() => new Response(null, { status: 401 }));
    render(
      <EditorSession map={MAP} repository={httpRepository(server)}>
        <EditorView />
      </EditorSession>,
    );

    fireEvent.doubleClick(nodeWrapper('a'));
    fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '过期后保留的改名' } });
    fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Enter' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      input: '/api/maps/m1',
      init: { method: 'PUT' },
    });
    expect(nodeWrapper('a').textContent).toBe('过期后保留的改名');
    expect(
      screen
        .getByRole('alert')
        .contains(screen.getByText('登录已过期，请在新标签页重新登录后继续编辑')),
    ).toBe(true);
    const relogin = screen.getByRole('link', { name: '重新登录' });
    expect(relogin.getAttribute('href')).toBe('/login?next=%2F');
    expect(relogin.getAttribute('target')).toBe('_blank');
  });

  it.each([
    { failure: 'HTTP 401', status: 401, notice: '登录已过期，请在新标签页重新登录后继续编辑' },
    { failure: 'HTTP 500', status: 500, notice: '保存失败' },
    { failure: 'network failure', status: null, notice: '保存失败' },
  ])('recovers both edits after $failure until notice dismissal', async ({ status, notice }) => {
    vi.useFakeTimers();
    const server = new MapFetch();
    server.respondNext(() => {
      if (status === null) throw new TypeError('network disconnected');
      return new Response(null, { status });
    });
    render(
      <EditorSession map={MAP} repository={httpRepository(server)}>
        <EditorView />
      </EditorSession>,
    );
    fireEvent.doubleClick(nodeWrapper('a'));
    fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '第一次修改' } });
    fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Enter' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(server.requests).toHaveLength(1);
    expect(nodeWrapper('a').textContent).toBe('第一次修改');
    expect(screen.getByText(notice)).toBeTruthy();
    expect(screen.queryByRole('link', { name: '重新登录' }) !== null).toBe(status === 401);

    fireEvent.doubleClick(nodeWrapper('r'));
    fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '第二次修改' } });
    fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Enter' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(server.requests).toHaveLength(2);
    const body = server.requests[1]?.init?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(body) as unknown).toMatchObject({
      schemaVersion: 1,
      map: {
        id: 'm1',
        roots: [{ id: 'r', text: '第二次修改', children: [{ id: 'a', text: '第一次修改' }] }],
      },
    });
    expect(nodeWrapper('a').textContent).toBe('第一次修改');
    expect(nodeWrapper('r').textContent).toBe('第二次修改');
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(server.requests).toHaveLength(2);
    expect(screen.getByText(notice)).toBeTruthy();
    expect(screen.queryByRole('link', { name: '重新登录' }) !== null).toBe(status === 401);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('link', { name: '重新登录' })).toBeNull();
  });

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
    act(() => {
      store?.getState().showNotice('主根不能删除');
    });
    expect(screen.getByRole('alert').textContent).toContain('主根不能删除');
    expect(screen.queryByText('保存失败')).toBeNull();
    expect(screen.queryByRole('link', { name: '重新登录' })).toBeNull();
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

describe('canvas delete selection', () => {
  it.each(['Delete', 'Backspace'])(
    '%s deletes selected subtrees, prunes selection and undoes once',
    (key) => {
      const { state, map } = creationEditor();
      fireEvent.click(nodeWrapper('b'));
      fireEvent.click(nodeWrapper('f'), { shiftKey: true });
      expect(fireEvent.keyDown(screen.getByRole('region'), { key })).toBe(false);
      expect(state().map).toStrictEqual(mapOf(node('r', [node('a'), node('c')])));
      expect(state().selectedIds).toEqual([]);
      expect(state().primaryId).toBeNull();
      expect(screen.queryByText('F')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '撤销' }));
      expect(state().map).toStrictEqual(map);
      expect(state().canUndo).toBe(false);
      expect(state().canRedo).toBe(true);
    },
  );

  it('keeps the selected root, displays one notice and dismisses it without changing history', () => {
    const { state, map } = creationEditor();
    fireEvent.click(nodeWrapper('r'));
    fireEvent.keyDown(screen.getByRole('region'), { key: 'a', ctrlKey: true });
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Delete' });
    expect(state().map).toStrictEqual(mapOf(node('r')));
    expect(state().selectedIds).toEqual(['r']);
    expect(state().primaryId).toBe('r');
    expect(nodeWrapper('r').querySelector('[aria-pressed="true"]')).not.toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('主根不能删除');
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(state().notice).toBeNull();
    expect(state().canUndo).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(state().map).toStrictEqual(map);
  });

  it.each(['Delete', 'Backspace'])(
    'keeps modified %s and IME native until an unmodified key',
    (key) => {
      const { state } = creationEditor();
      fireEvent.click(nodeWrapper('a'));
      const region = screen.getByRole('region');
      const before = state();
      for (const options of [
        { altKey: true },
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { isComposing: true },
        { keyCode: 229 },
      ]) {
        expect(fireEvent.keyDown(region, { key, ...options })).toBe(true);
        expect(state()).toBe(before);
      }
      fireEvent.compositionStart(region);
      expect(fireEvent.keyDown(region, { key })).toBe(true);
      expect(state()).toBe(before);
      fireEvent.compositionEnd(region);
      expect(fireEvent.keyDown(region, { key })).toBe(false);
      expect(screen.queryByText('A')).toBeNull();
    },
  );

  it.each(['input', 'textarea', 'select', 'div'])(
    'keeps %s text focus and targets native',
    (tag) => {
      const { state } = creationEditor();
      fireEvent.click(nodeWrapper('a'));
      const region = screen.getByRole('region');
      const field = document.createElement(tag);
      if (tag === 'div') field.setAttribute('contenteditable', 'true');
      field.tabIndex = 0;
      region.append(field);
      const target = tag === 'div' ? field.appendChild(document.createElement('span')) : field;
      const before = state();
      for (const key of ['Delete', 'Backspace']) {
        expect(fireEvent.keyDown(target, { key })).toBe(true);
        field.focus();
        expect(fireEvent.keyDown(region, { key })).toBe(true);
        expect(state()).toBe(before);
        field.blur();
      }
      field.remove();
      expect(fireEvent.keyDown(region, { key: 'Delete' })).toBe(false);
      expect(screen.queryByText('A')).toBeNull();
    },
  );

  it.each(['rename', 'creation'])(
    'keeps both deletion keys native during %s, including unfocused editing',
    (mode) => {
      const { state } = creationEditor();
      fireEvent.click(nodeWrapper('a'));
      if (mode === 'rename') fireEvent.keyDown(screen.getByRole('region'), { key: 'F2' });
      else fireEvent.keyDown(screen.getByRole('region'), { key: 'Tab' });
      const input = screen.getByLabelText('节点标题');
      const before = state();
      for (const key of ['Delete', 'Backspace']) {
        expect(fireEvent.keyDown(input, { key })).toBe(true);
        expect(fireEvent.keyDown(screen.getByRole('region'), { key })).toBe(true);
        expect(state()).toBe(before);
      }
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.click(nodeWrapper('a'));
      expect(fireEvent.keyDown(screen.getByRole('region'), { key: 'Backspace' })).toBe(false);
      expect(screen.queryByText('A')).toBeNull();
    },
  );
});
