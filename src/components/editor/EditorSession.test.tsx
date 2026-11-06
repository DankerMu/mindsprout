import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { mapOf, node, sampleMap } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import {
  createEditorStore,
  type EditorState,
} from '../../contexts/map/application/editor-store/editor-store';
import type { TreeOp } from '../../contexts/map/domain/tree-op';
import type { MindMap } from '../../contexts/map/domain/types';
import { EditorSession, selectMap, useEditorStore } from './EditorSession';

// Design "Fixture — issue #16": EditorSession through Testing Library with a recording stub
// repository and a probe child that reads and dispatches through useEditorStore. Fake timers keep
// the 500 ms autosave debounce from firing, so every put seen here is a flush.

failOnConsoleNoise();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// sampleMap(): r ─ p ─ (a, b)          f1 @ (10, 20) ─ fc
const RENAME_A: TreeOp = { op: 'update_node', id: 'a', text: '改名' };
const ADD_Q: TreeOp = { op: 'add_children', parentId: 'r', children: [{ id: 'q', text: 'Q' }] };

// sampleMap's roots after RENAME_A, written out by hand.
const RENAMED_ROOTS = mapOf(
  node('r', [node('p', [node('a', [], { text: '改名' }), node('b')])]),
  node('f1', [node('fc')], { position: { x: 10, y: 20 } }),
).roots;

// Every state the probe child rendered with, read through useEditorStore.
interface Probe {
  states: EditorState[];
}

function latest(probe: Probe): EditorState {
  const state = probe.states.at(-1);
  if (state === undefined) throw new Error('the probe has not rendered');
  return state;
}

function renderSession(map: MindMap = sampleMap()) {
  const repository = new RecordingRepository();
  const probe: Probe = { states: [] };
  function ProbeChild() {
    probe.states.push(useEditorStore((state) => state));
    return null;
  }
  const view = render(
    <EditorSession map={map} repository={repository}>
      <ProbeChild />
    </EditorSession>,
  );
  return { repository, probe, unmount: view.unmount };
}

function dispatchThroughProbe(probe: Probe, op: TreeOp): void {
  act(() => {
    latest(probe).dispatch(op);
  });
}

function firePagehide(): void {
  window.dispatchEvent(new Event('pagehide'));
}

describe('EditorSession', () => {
  it('hands the probe the loaded map', () => {
    const { probe } = renderSession();

    expect(latest(probe).map).toStrictEqual(sampleMap());
  });

  it('writes nothing on open, even after a second', () => {
    const { repository } = renderSession();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(repository.puts).toStrictEqual([]);
  });

  it('puts the edited map synchronously on pagehide', () => {
    const { repository, probe } = renderSession();
    dispatchThroughProbe(probe, RENAME_A);

    firePagehide();

    expect(repository.puts).toHaveLength(1);
    expect(repository.puts[0]?.roots).toStrictEqual(RENAMED_ROOTS);
  });

  it('puts nothing on pagehide when no save is pending', () => {
    const { repository } = renderSession();

    firePagehide();

    expect(repository.puts).toStrictEqual([]);
  });

  it('puts the edited map synchronously on unmount', () => {
    const { repository, probe, unmount } = renderSession();
    dispatchThroughProbe(probe, RENAME_A);

    unmount();

    expect(repository.puts).toHaveLength(1);
    expect(repository.puts[0]?.roots).toStrictEqual(RENAMED_ROOTS);
  });

  it('stops listening for pagehide once unmounted', () => {
    const { repository, probe, unmount } = renderSession();
    dispatchThroughProbe(probe, RENAME_A);
    const captured = latest(probe);
    unmount();
    expect(repository.puts).toHaveLength(1);

    captured.dispatch(ADD_Q);
    firePagehide();

    expect(repository.puts).toHaveLength(1);
  });

  it('throws when useEditorStore is used outside the session', () => {
    function Orphan() {
      useEditorStore((state) => state.map);
      return null;
    }

    expect(() => render(<Orphan />)).toThrow('useEditorStore must be used inside');
  });
});

describe('selectMap', () => {
  it('returns the loaded map', () => {
    const store = createEditorStore();
    store.getState().load(sampleMap());

    expect(selectMap(store.getState())).toStrictEqual(sampleMap());
  });

  it('throws on a store with no map loaded', () => {
    expect(() => selectMap(createEditorStore().getState())).toThrow('no map loaded');
  });
});
