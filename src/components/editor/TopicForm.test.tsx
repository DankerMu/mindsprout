import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { failOnConsoleNoise, nodeWrapper } from '../../../tests/support/canvas';
import { FakeGenerateSource } from '../../../tests/support/generate-source';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { GenerateError } from '../../contexts/map/domain/errors';
import type { TreeOp } from '../../contexts/map/domain/tree-op';
import type { MindMap } from '../../contexts/map/domain/types';
import { EditorSession, useEditorStoreApi } from './EditorSession';
import { EditorView } from './EditorView';

// "Issue #310 Fixture Triage": the topic form, Stop and generation notices, rendered through
// EditorSession and EditorView over a real store and the #308 fake source. The store's own
// refusals throw synchronously, so a missing form guard shows only as a console or window error:
// failOnConsoleNoise plus the window error listener below must both stay empty.

failOnConsoleNoise();

const NEW_MAP: MindMap = { ...mapOf(node('r', [], { text: '中心主题' })), title: '新导图' };
const GROW: TreeOp = {
  op: 'add_children',
  parentId: 'r',
  children: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
};

const errors: unknown[] = [];
function recordError(event: ErrorEvent): void {
  errors.push(event.error);
}
beforeEach(() => {
  errors.length = 0;
  window.addEventListener('error', recordError);
});
// Unmount first: unmount-time errors count too, and a failure here must not skip the cleanup.
afterEach(() => {
  cleanup();
  window.removeEventListener('error', recordError);
  expect(errors).toStrictEqual([]);
});

function editor(map: MindMap = NEW_MAP) {
  const source = new FakeGenerateSource();
  let store!: StoreApi<EditorState>;
  function Probe() {
    store = useEditorStoreApi();
    return null;
  }
  render(
    <EditorSession map={map} repository={new RecordingRepository()} generateSource={source}>
      <Probe />
      <EditorView />
    </EditorSession>,
  );
  const state = () => store.getState();
  return {
    source,
    state,
    async submit(topic: string) {
      fireEvent.change(topicInput(), { target: { value: topic } });
      await act(async () => {
        fireEvent.click(generateButton());
        await Promise.resolve();
      });
      expect(state().generating).toBe(true);
    },
    async push(op: TreeOp = GROW) {
      await act(() => source.run(0).push(op));
    },
    async ended() {
      await waitFor(() => {
        expect(state().generating).toBe(false);
      });
    },
  };
}

function topicInput(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name: '主题' });
}

function generateButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: '生成' });
}

function topicForm(): HTMLFormElement {
  const form = topicInput().form;
  if (form === null) throw new Error('the topic input is not inside a form');
  return form;
}

function formShown(): boolean {
  return (
    screen.queryByRole('textbox', { name: '主题' }) !== null ||
    screen.queryByRole('button', { name: '生成' }) !== null
  );
}

function stopShown(): boolean {
  return screen.queryByRole('button', { name: '停止生成' }) !== null;
}

describe('topic form on a new map', () => {
  it('shows the input and a 生成 enabled by valid text, as a bar between header and canvas', () => {
    editor();

    expect(topicInput().value).toBe('');
    expect(generateButton().disabled).toBe(true);
    fireEvent.change(topicInput(), { target: { value: '学习 TypeScript' } });
    expect(generateButton().disabled).toBe(false);
    expect(generateButton().type).toBe('submit');
    expect(stopShown()).toBe(false);
    const region = screen.getByRole('region', { name: '思维导图画布' });
    expect(screen.getByRole('banner').nextElementSibling).toBe(topicForm());
    expect(region.contains(topicForm())).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it.each([
    ['a root with a child', mapOf(node('r', [node('c')]))],
    ['a floating root', mapOf(node('r'), node('f', [], { position: { x: 300, y: 40 } }))],
  ])('renders no input and no 生成 on %s', (_label, map) => {
    editor({ ...map, title: '新导图' });

    expect(formShown()).toBe(false);
  });
});

describe('topic validity', () => {
  it.each([
    ['blank', ''],
    ['only spaces', '   '],
    ['201 ASCII characters', 'a'.repeat(201)],
    ['101 astral characters (202 code units)', '𐀀'.repeat(101)],
  ])('keeps 生成 disabled for %s and a form submit makes no request', (_label, topic) => {
    const { source, state } = editor();
    fireEvent.change(topicInput(), { target: { value: topic } });

    expect(generateButton().disabled).toBe(true);
    fireEvent.submit(topicForm());
    expect(source.runs).toHaveLength(0);
    expect(state().generating).toBe(false);
  });

  it.each([
    ['200 ASCII characters', 'a'.repeat(200), 'a'.repeat(200)],
    ['a padded topic trimming to 200', `  ${'b'.repeat(200)}  `, 'b'.repeat(200)],
  ])('enables 生成 for %s and submits the trimmed topic', async (_label, topic, trimmed) => {
    const form = editor();
    fireEvent.change(topicInput(), { target: { value: topic } });

    expect(generateButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.submit(topicForm());
      await Promise.resolve();
    });
    expect(form.source.runs.map((run) => run.input)).toStrictEqual([
      { topic: trimmed, rootId: 'r' },
    ]);
    form.source.run(0).finish();
    await form.ended();
  });
});

describe('a running generation', () => {
  it('ignores a second submit: one request, no error', async () => {
    const lock = editor();
    await lock.submit('主题');

    fireEvent.submit(topicForm());
    expect(lock.source.runs).toHaveLength(1);
    lock.source.run(0).finish();
    await lock.ended();
  });

  it('makes the input read-only and hides 生成 before the first op', async () => {
    const lock = editor();
    await lock.submit('主题');

    expect(topicInput().readOnly).toBe(true);
    expect(topicInput().value).toBe('主题');
    expect(screen.queryByRole('button', { name: '生成' })).toBeNull();
    lock.source.run(0).finish();
    await lock.ended();
    expect(topicInput().readOnly).toBe(false);
    expect(generateButton().disabled).toBe(false);
  });

  it('grows the root text and the title, hides the form and keeps Stop after the first op', async () => {
    const lock = editor();
    await lock.submit('学习 TypeScript');
    expect(screen.getByTestId('editor-title').textContent).toBe('新导图');

    await lock.push();
    expect(formShown()).toBe(false);
    expect(stopShown()).toBe(true);
    expect(screen.getByTestId('editor-title').textContent).toBe('学习 TypeScript');
    expect(nodeWrapper('r').textContent).toBe('学习 TypeScript');
    lock.source.run(0).finish();
    await lock.ended();
    expect(stopShown()).toBe(false);
  });
});

describe('Stop', () => {
  it('shows from submit, before and after the first op, and ends the generation keeping nodes', async () => {
    const lock = editor();
    expect(stopShown()).toBe(false);
    await lock.submit('主题');
    expect(stopShown()).toBe(true);
    await lock.push();
    expect(stopShown()).toBe(true);

    const stop = screen.getByRole<HTMLButtonElement>('button', { name: '停止生成' });
    expect(stop.type).toBe('button');
    fireEvent.click(stop);
    expect(lock.state().generating).toBe(false);
    expect(stopShown()).toBe(false);
    expect(lock.source.run(0).signal.aborted).toBe(true);
    expect(['a', 'b'].map((id) => nodeWrapper(id).textContent)).toEqual(['A', 'B']);
    lock.source.run(0).finish();
  });
});

describe('manual editing while the form shows', () => {
  it('selects the root by click and creates a child with Tab, which hides the form', () => {
    const { state } = editor();
    const region = screen.getByRole('region', { name: '思维导图画布' });

    fireEvent.click(nodeWrapper('r'));
    expect(state().selectedIds).toEqual(['r']);
    expect(fireEvent.keyDown(region, { key: 'Tab' })).toBe(false);
    expect(state().map?.roots[0]?.children).toHaveLength(1);
    expect(state().editing?.created).toBe(true);
    expect(formShown()).toBe(false);
  });
});

describe('generation outcomes', () => {
  it('shows AI 未配置 in place of the input when AI is unavailable, the map unchanged', async () => {
    const lock = editor();
    const before = lock.state().map;
    await lock.submit('主题');

    lock.source.run(0).fail(new GenerateError('ai-unavailable'));
    await lock.ended();
    expect(screen.getByText('AI 未配置')).toBeTruthy();
    expect(formShown()).toBe(false);
    expect(lock.state().map).toBe(before);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the network failure notice and keeps the draft for a retry', async () => {
    const lock = editor();
    await lock.submit('主题');

    lock.source.run(0).fail(new GenerateError('network'));
    await lock.ended();
    expect(screen.getByRole('alert').textContent).toContain(
      '生成失败：网络连接失败，请检查网络后重试',
    );
    expect(topicInput().value).toBe('主题');
    expect(generateButton().disabled).toBe(false);
  });

  it('shows the session-expiry notice and the 重新登录 link without navigating', async () => {
    const lock = editor();
    const href = window.location.href;
    await lock.submit('主题');

    lock.source.run(0).fail(new GenerateError('unauthenticated'));
    await lock.ended();
    expect(screen.getByRole('alert').textContent).toContain(
      '登录已过期，请在新标签页重新登录后继续编辑',
    );
    expect(screen.getByRole('link', { name: '重新登录' }).getAttribute('href')).toBe(
      '/login?next=%2F',
    );
    expect(window.location.href).toBe(href);
  });
});

describe('a note draft when 生成 is clicked', () => {
  it('commits the draft before the generate group, so undo keeps the note', async () => {
    const lock = editor();
    act(() => {
      lock.state().setSelection(['r']);
    });
    const note = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '节点备注' });
    note.focus();
    fireEvent.change(note, { target: { value: '先写的备注' } });
    fireEvent.change(topicInput(), { target: { value: '主题' } });

    // fireEvent.click moves no focus; a browser focuses the button first, which blurs the note.
    act(() => {
      generateButton().focus();
    });
    await act(async () => {
      fireEvent.click(generateButton());
      await Promise.resolve();
    });
    expect(lock.state().map?.roots[0]?.note).toBe('先写的备注');
    await lock.push();
    lock.source.run(0).finish();
    await lock.ended();
    act(() => {
      lock.state().undo();
    });
    expect(lock.state().map?.roots).toStrictEqual([
      { id: 'r', text: '中心主题', note: '先写的备注', children: [] },
    ]);
  });
});
