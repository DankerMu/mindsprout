import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { nodeWrapper, renderedPosition, viewportTransform } from '../../../tests/support/canvas';
import { measure, move, start, stop } from '../../../tests/support/canvas-drag';
import { FakeGenerateSource } from '../../../tests/support/generate-source';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import type { TreeOp } from '../../contexts/map/domain/tree-op';
import { EditorSession, useEditorStoreApi } from '../editor/EditorSession';
import { EditorView } from '../editor/EditorView';

// "Issue #309 Fixture Triage": every canvas entry point is inert while the store is generating.
// A real store with the #308 fake source, rendered through EditorSession and EditorView. The store
// lock alone keeps the map unchanged, so the detecting assertions are the absence of console and
// window errors, defaultPrevented, the rendered menu, `.draggable`, `disabled` and `readOnly`.
// canvas-drag registers failOnConsoleNoise, the controllable ResizeObserver and geometry stubs.

const EMPTY = mapOf(node('r'));
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

function editor() {
  const source = new FakeGenerateSource();
  let store!: StoreApi<EditorState>;
  function Probe() {
    store = useEditorStoreApi();
    return null;
  }
  render(
    <EditorSession map={EMPTY} repository={new RecordingRepository()} generateSource={source}>
      <Probe />
      <EditorView />
    </EditorSession>,
  );
  measure(['r']);
  const state = () => store.getState();
  let done: Promise<void> = Promise.resolve();
  return {
    store,
    state,
    region: screen.getByRole('region', { name: '思维导图画布' }),
    async generate() {
      await act(async () => {
        done = state().generate('主题');
        await Promise.resolve();
      });
      expect(state().generating).toBe(true);
    },
    async push(op: TreeOp = GROW) {
      await act(() => source.run(0).push(op));
    },
    async stop() {
      await act(async () => {
        state().stopGeneration();
        await Promise.resolve();
      });
    },
    async finish() {
      source.run(0).finish();
      await act(() => done);
    },
  };
}

function select(state: () => EditorState, ...ids: string[]): void {
  act(() => {
    state().setSelection(ids);
  });
}

function draggable(id: string): boolean {
  return nodeWrapper(id).classList.contains('draggable');
}

function historyButtons() {
  return ['撤销', '重做'].map((name) => screen.getByRole<HTMLButtonElement>('button', { name }));
}

function noteField() {
  return screen.getByRole<HTMLTextAreaElement>('textbox', { name: '节点备注' });
}

describe('shortcuts during a generation', () => {
  it.each([
    ['Tab', { key: 'Tab' }],
    ['Enter', { key: 'Enter' }],
    ['F2', { key: 'F2' }],
    ['Delete', { key: 'Delete' }],
    ['Cmd+Z', { key: 'z', metaKey: true }],
    ['Ctrl+Z', { key: 'z', ctrlKey: true }],
    ['Cmd+Shift+Z', { key: 'Z', metaKey: true, shiftKey: true }],
  ])('ignores %s on a selected node without preventing its default', async (_name, init) => {
    const lock = editor();
    await lock.generate();
    await lock.push();
    select(lock.state, 'a');
    const before = lock.state().map;

    expect(fireEvent.keyDown(lock.region, init)).toBe(true);
    expect(lock.state().map).toBe(before);
    expect(lock.state().editing).toBeNull();
    await lock.finish();
  });
});

describe('selection, double-click and the menu during a generation', () => {
  it('keeps keyboard, click, shift-click and rubber-band selection', async () => {
    const lock = editor();
    await lock.generate();
    await lock.push();
    const { state, region } = lock;

    fireEvent.keyDown(region, { key: 'a', metaKey: true });
    expect(state().selectedIds).toEqual(['r', 'a', 'b']);
    select(state, 'r');
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    fireEvent.keyDown(region, { key: 'ArrowDown' });
    expect(state().selectedIds).toEqual(['b']);
    fireEvent.click(nodeWrapper('a'));
    expect(state().selectedIds).toEqual(['a']);
    fireEvent.click(nodeWrapper('b'), { shiftKey: true });
    expect(state().selectedIds).toEqual(['a', 'b']);

    fireEvent.click(nodeWrapper('r'));
    Object.assign(region, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    const pane = region.querySelector('.react-flow__pane');
    if (pane === null) throw new Error('no pane');
    const view = viewportTransform();
    const a = renderedPosition('a');
    const b = renderedPosition('b');
    const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    fireEvent.pointerDown(pane, {
      ...pointer,
      clientX: a.x + view.x - 5,
      clientY: a.y + view.y - 5,
    });
    const end = { ...pointer, clientX: b.x + view.x + 100, clientY: b.y + view.y + 40 };
    fireEvent.pointerMove(region, end);
    fireEvent.pointerUp(region, end);
    expect(state().selectedIds).toEqual(['a', 'b']);
    expect(state().generating).toBe(true);
    await lock.finish();
  });

  it('opens no title editor on a double-click', async () => {
    const lock = editor();
    await lock.generate();
    await lock.push();

    fireEvent.doubleClick(nodeWrapper('a'));
    expect(screen.queryByRole('textbox', { name: '节点标题' })).toBeNull();
    expect(lock.state().editing).toBeNull();
    await lock.finish();
  });

  it('renders no menu on a right-click and leaves the native menu alone', async () => {
    const lock = editor();
    await lock.generate();
    await lock.push();
    const targets: (string | null)[] = [];
    const unsubscribe = lock.store.subscribe((state) => {
      targets.push(state.menuTargetId);
    });

    expect(fireEvent.contextMenu(nodeWrapper('a'), { clientX: 130, clientY: 100 })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(targets.filter((target) => target !== null)).toEqual([]);
    unsubscribe();
    await lock.finish();
  });

  it('closes a menu opened before the generation, before any op, without running an entry', async () => {
    const lock = editor();
    expect(fireEvent.contextMenu(nodeWrapper('r'), { clientX: 130, clientY: 100 })).toBe(false);
    expect(screen.getByRole('menu')).toBeTruthy();
    const before = lock.state().map;

    await lock.generate();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(lock.state().menuTargetId).toBeNull();
    expect(lock.state().map).toBe(before);
    await lock.finish();
  });
});

describe('drag, history and note during a generation', () => {
  it('drops the draggable class in the zero-op and the one-op state', async () => {
    const lock = editor();
    expect(draggable('r')).toBe(true);
    await lock.generate();
    expect(draggable('r')).toBe(false);
    await lock.push();
    expect(['r', 'a', 'b'].map(draggable)).toEqual([false, false, false]);
    await lock.finish();
  });

  it('cancels a drag that started before the generation; its drop dispatches nothing', async () => {
    const lock = editor();
    const origin = start('r');
    move(420, 310);
    expect(renderedPosition('r')).toStrictEqual({ x: 400, y: 300 });
    const before = lock.state().map;

    await lock.generate();
    expect(renderedPosition('r')).toStrictEqual(origin);
    move(440, 330);
    expect(renderedPosition('r')).toStrictEqual(origin);
    stop(440, 330);
    expect(lock.state().map).toBe(before);
    await lock.finish();
  });

  it('disables undo and redo while both are available, before and after the first op', async () => {
    const lock = editor();
    act(() => {
      lock.state().dispatch({ op: 'update_node', id: 'r', note: '一' });
      lock.state().dispatch({ op: 'update_node', id: 'r', note: '二' });
      lock.state().undo();
    });
    expect(historyButtons().map((button) => button.disabled)).toEqual([false, false]);

    await lock.generate();
    expect([lock.state().canUndo, lock.state().canRedo]).toEqual([true, true]);
    expect(historyButtons().map((button) => button.disabled)).toEqual([true, true]);
    await lock.push();
    expect([lock.state().canUndo, lock.state().canRedo]).toEqual([true, true]);
    expect(historyButtons().map((button) => button.disabled)).toEqual([true, true]);
    await lock.finish();
  });

  it('makes the note read-only and drops a blur commit fired while generating', async () => {
    const lock = editor();
    select(lock.state, 'r');
    expect(noteField().readOnly).toBe(false);
    fireEvent.change(noteField(), { target: { value: '草稿' } });
    const before = lock.state().map;

    await lock.generate();
    expect(noteField().readOnly).toBe(true);
    fireEvent.blur(noteField());
    expect(lock.state().map).toBe(before);
    await lock.finish();
  });
});

describe('after the generation ends', () => {
  it.each(['completion', 'Stop'])('works again after %s', async (ending) => {
    const lock = editor();
    await lock.generate();
    await lock.push();
    if (ending === 'Stop') await lock.stop();
    await lock.finish();
    const { state, region } = lock;
    expect(state().generating).toBe(false);

    expect(draggable('a')).toBe(true);
    expect(historyButtons().map((button) => button.disabled)).toEqual([
      !state().canUndo,
      !state().canRedo,
    ]);
    expect(state().canUndo).toBe(true);
    expect(fireEvent.contextMenu(nodeWrapper('a'), { clientX: 130, clientY: 100 })).toBe(false);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    select(state, 'a');
    expect(fireEvent.keyDown(region, { key: 'Tab' })).toBe(false);
    expect(state().editing?.created).toBe(true);
  });
});
