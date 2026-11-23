import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADD_C,
  currentMap,
  RENAME_A,
  scriptedIds,
  type Store,
} from '../../../../../tests/support/editor-store';
import {
  entriesOf,
  mapOf,
  node,
  nodeIn,
  sampleMap,
  UPDATED_AT,
  // Applies any op list in order through the checked apply helper — the expected-map oracle here.
  undo as applied,
} from '../../../../../tests/support/map-domain';
import { httpRepository, MapFetch } from '../../../../../tests/support/map-fetch';
import { heldResult } from '../../../../../tests/support/map-library';
import { RecordingRepository } from '../../../../../tests/support/map-repository-stub';
import { StorageUnauthorizedError } from '../../domain/errors';
import type { TreeOp } from '../../domain/tree-op';
import type { MindMap, NodeId } from '../../domain/types';
import { AUTOSAVE_DELAY_MS, createEditorStore, type EditorState } from './editor-store';

// Design "Fixture — issue #13" / D7, specs map-persistence "Autosave after every change", "Saves
// stamp updatedAt", "Save failures are visible" — through the createEditorStore public API
// with a recording stub MapRepository and vi fake timers (Date included, so the injected clock
// `() => new Date()` reads fake time: a put's updatedAt names the moment its write started).

// sampleMap(): r ─ p ─ (a, b)          f1 @ (10, 20) ─ fc        updatedAt UPDATED_AT (T0)
const START = '2026-11-06T08:00:00.000Z';
const SAVE_FAILED = '保存失败';
const SESSION_EXPIRED = '登录已过期，请在新标签页重新登录后继续编辑';

// A second map with its own id, for load-while-pending cases.
function otherMap(): MindMap {
  return { ...mapOf(node('x', [node('y')])), id: 'm2', title: '另一张' };
}

function saving(map: MindMap = sampleMap()): { store: Store; repository: RecordingRepository } {
  const repository = new RecordingRepository();
  const store = createEditorStore({
    now: () => new Date(),
    newId: scriptedIds('n1', 'n2'),
    repository,
  });
  store.getState().load(map);
  return { store, repository };
}

function idsIn(map: MindMap): NodeId[] {
  return entriesOf(map).map((entry) => entry.node.id);
}

function addChild(id: NodeId): TreeOp {
  return { op: 'add_children', parentId: 'p', children: [{ id, text: id.toUpperCase() }] };
}

// Lets settled puts run their continuations (fake timers do not advance microtasks on their own).
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function putAt(repository: RecordingRepository, index: number): MindMap {
  const map = repository.puts[index];
  if (map === undefined) throw new Error(`expected put #${String(index)}`);
  return map;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(START) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('autosave debounce (spec "Rapid edits coalesce")', () => {
  it('writes ten ops dispatched 20 ms apart as one put, 500 ms after the last op', () => {
    const { store, repository } = saving();
    const ops = Array.from({ length: 10 }, (_, i) => addChild(`c${String(i)}`));
    ops.forEach((op, i) => {
      if (i > 0) vi.advanceTimersByTime(20);
      store.getState().dispatch(op);
    });

    vi.advanceTimersByTime(499);
    expect(repository.puts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(repository.puts).toHaveLength(1);
    expect(putAt(repository, 0).roots).toStrictEqual(currentMap(store).roots);
    expect(putAt(repository, 0).roots).toStrictEqual(applied(sampleMap(), ops).roots);
  });

  it('writes three ops within 500 ms exactly once', () => {
    const { store, repository } = saving();
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(200);
    store.getState().dispatch(ADD_C);
    vi.advanceTimersByTime(200);
    store.getState().dispatch(addChild('d'));

    vi.advanceTimersByTime(5000);
    expect(repository.puts).toHaveLength(1);
    expect(putAt(repository, 0).roots).toStrictEqual(
      applied(sampleMap(), [RENAME_A, ADD_C, addChild('d')]).roots,
    );
  });

  it('restarts the timer on every change: ops 400 ms apart are written 500 ms after the third', () => {
    const { store, repository } = saving();
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(400);
    store.getState().dispatch(ADD_C);
    vi.advanceTimersByTime(400);
    store.getState().dispatch(addChild('d'));

    vi.advanceTimersByTime(499);
    expect(repository.puts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(repository.puts).toHaveLength(1);
  });
});

describe('autosave stamping (spec "Save stamps updatedAt")', () => {
  it('stamps updatedAt at write start without writing it back into state', () => {
    const { store, repository } = saving();
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

    expect(repository.puts).toHaveLength(1);
    const put = putAt(repository, 0);
    expect(put.updatedAt).toBe('2026-11-06T08:00:00.500Z');
    expect(put.updatedAt > UPDATED_AT).toBe(true);
    const state = currentMap(store);
    expect({
      id: put.id,
      title: put.title,
      createdAt: put.createdAt,
      roots: put.roots,
    }).toStrictEqual({
      id: state.id,
      title: state.title,
      createdAt: state.createdAt,
      roots: state.roots,
    });
    expect(put).toStrictEqual({ ...state, updatedAt: '2026-11-06T08:00:00.500Z' });
    expect(state.updatedAt).toBe(UPDATED_AT);
  });

  it('a write schedules no further write (no save loop)', () => {
    const { store, repository } = saving();
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(repository.puts).toHaveLength(1);

    vi.advanceTimersByTime(5000);
    expect(repository.puts).toHaveLength(1);
  });

  it('writes undo and redo results, one put each', () => {
    const { store, repository } = saving();
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    store.getState().undo();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    store.getState().redo();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

    expect(repository.puts.map((map) => map.roots)).toStrictEqual([
      applied(sampleMap(), [RENAME_A]).roots,
      sampleMap().roots,
      applied(sampleMap(), [RENAME_A]).roots,
    ]);
  });

  it('writes a rename once, with the new title and updatedAt stamped at write start', () => {
    const { store, repository } = saving();
    vi.advanceTimersByTime(1000);
    store.getState().rename('新标题');
    expect(currentMap(store).updatedAt).toBe('2026-11-06T08:00:01.000Z');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    vi.advanceTimersByTime(5000);

    expect(repository.puts).toHaveLength(1);
    expect(putAt(repository, 0).title).toBe('新标题');
    expect(putAt(repository, 0).updatedAt).toBe('2026-11-06T08:00:01.500Z');
    expect(currentMap(store).updatedAt).toBe('2026-11-06T08:00:01.000Z');
  });
});

describe('autosave writes only edits (spec "Opening a map is not an edit")', () => {
  // Each case ends with one real edit, so a store that never saves cannot pass by writing nothing.
  function expectOnlyTheEditWritten(store: Store, repository: RecordingRepository): void {
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(repository.puts.map((map) => map.roots)).toStrictEqual([
      applied(sampleMap(), [RENAME_A]).roots,
    ]);
  }

  it('never writes a loaded map that receives no op', () => {
    const { store, repository } = saving();
    vi.advanceTimersByTime(10_000);
    expect(repository.puts).toHaveLength(0);
    expectOnlyTheEditWritten(store, repository);
  });

  const nonEdits: [string, (state: EditorState) => void][] = [
    [
      'select',
      (state) => {
        state.select('a');
      },
    ],
    [
      'openMenu',
      (state) => {
        state.openMenu('a');
      },
    ],
    [
      'showNotice',
      (state) => {
        state.showNotice('提示');
      },
    ],
    [
      'beginGroup + endGroup with no ops',
      (state) => {
        state.beginGroup('g');
        state.endGroup();
      },
    ],
    [
      'undo on an empty stack',
      (state) => {
        state.undo();
      },
    ],
    [
      'redo on an empty stack',
      (state) => {
        state.redo();
      },
    ],
  ];

  it.each(nonEdits)('%s schedules no write', (_, act) => {
    const { store, repository } = saving();
    act(store.getState());
    vi.advanceTimersByTime(1000);
    expect(repository.puts).toHaveLength(0);
    expectOnlyTheEditWritten(store, repository);
  });
});

describe('autosave and open groups (spec "Unnamed new node is not saved")', () => {
  it('writes the last stable map while a creation edit is open, never the new node', () => {
    const { store, repository } = saving();
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(100);
    const id = store.getState().createNode('p');
    vi.advanceTimersByTime(400);

    expect(repository.puts).toHaveLength(1);
    expect(nodeIn(putAt(repository, 0), 'a').text).toBe('A2');
    expect(idsIn(putAt(repository, 0))).not.toContain(id);
    vi.advanceTimersByTime(2000);
    expect(repository.puts).toHaveLength(1);
  });

  it('flush during a creation edit writes the pending stable map without the new node', async () => {
    const { store, repository } = saving();
    store.getState().dispatch(RENAME_A);
    const id = store.getState().createNode('p');
    await store.getState().flush();
    vi.advanceTimersByTime(2000);

    expect(repository.puts).toHaveLength(1);
    expect(putAt(repository, 0).roots).toStrictEqual(applied(sampleMap(), [RENAME_A]).roots);
    expect(idsIn(putAt(repository, 0))).not.toContain(id);
  });

  it('flush during a creation edit with nothing pending writes nothing', async () => {
    const { store, repository } = saving();
    store.getState().createNode('p');
    await store.getState().flush();
    expect(repository.puts).toHaveLength(0);
  });

  it('writes the new node once its title is committed', () => {
    const { store, repository } = saving();
    const id = store.getState().createNode('p');
    store.getState().commitTitle('x');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

    expect(repository.puts).toHaveLength(1);
    expect(nodeIn(putAt(repository, 0), id).text).toBe('x');
  });

  it('never writes a node whose creation was cancelled', () => {
    const { store, repository } = saving();
    const id = store.getState().createNode('p');
    vi.advanceTimersByTime(1000);
    store.getState().cancelEdit();
    vi.advanceTimersByTime(1000);
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

    expect(repository.puts.at(-1)?.roots).toStrictEqual(applied(sampleMap(), [RENAME_A]).roots);
    for (const map of repository.puts) expect(idsIn(map)).not.toContain(id);
  });

  it('writes an explicit group once, 500 ms after endGroup, and nothing while it is open', () => {
    const { store, repository } = saving();
    store.getState().beginGroup('g');
    store.getState().dispatch(RENAME_A);
    store.getState().dispatch(ADD_C);
    vi.advanceTimersByTime(1000);
    expect(repository.puts).toHaveLength(0);

    store.getState().endGroup();
    vi.advanceTimersByTime(499);
    expect(repository.puts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(repository.puts).toHaveLength(1);
    expect(putAt(repository, 0).roots).toStrictEqual(applied(sampleMap(), [RENAME_A, ADD_C]).roots);
  });
});

describe('autosave flush', () => {
  it('writes a pending save at once and resolves after that write settles', async () => {
    const { store, repository } = saving();
    const held = repository.holdNext();
    store.getState().dispatch(RENAME_A);
    let settled = false;
    const flushed = store
      .getState()
      .flush()
      .then(() => {
        settled = true;
      });

    expect(repository.puts).toHaveLength(1);
    await settle();
    expect(settled).toBe(false);
    held.resolve();
    await flushed;
    expect(settled).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(repository.puts).toHaveLength(1);
  });

  it('resolves without a put when nothing is pending', async () => {
    const { store, repository } = saving();
    await expect(store.getState().flush()).resolves.toBeUndefined();
    expect(repository.puts).toHaveLength(0);
  });

  it('resolves at once on a store without a repository', async () => {
    await expect(createEditorStore().getState().flush()).resolves.toBeUndefined();
  });
});

describe('a store without a repository', () => {
  it('schedules no timer', () => {
    const store = createEditorStore({ now: () => new Date() });
    store.getState().load(sampleMap());
    store.getState().dispatch(RENAME_A);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('load while a save is pending', () => {
  it('writes the previous map synchronously during load and never writes the loaded one', () => {
    const { store, repository } = saving();
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(100);
    store.getState().load(otherMap());

    expect(repository.puts).toHaveLength(1);
    expect(putAt(repository, 0).id).toBe('m1');
    expect(putAt(repository, 0).roots).toStrictEqual(applied(sampleMap(), [RENAME_A]).roots);
    vi.advanceTimersByTime(10_000);
    expect(repository.puts).toHaveLength(1);
  });
});

describe('autosave failures (spec "Save failures are visible")', () => {
  it.each([
    ['an Error', new Error('disk I/O')],
    ['a DOMException', new DOMException('quota', 'QuotaExceededError')],
  ])('%s from put shows "保存失败" and keeps the edit', async (_, error) => {
    const { store, repository } = saving();
    repository.rejectNext(error);
    store.getState().dispatch(RENAME_A);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(store.getState().notice).toBe(SAVE_FAILED);
    expect(currentMap(store)).toStrictEqual(applied(sampleMap(), [RENAME_A]));
  });

  it('retries a failed write on flush, publishes the notice once, and flush never rejects', async () => {
    const { store, repository } = saving();
    let noticeChanges = 0;
    store.subscribe((state, previous) => {
      if (state.notice !== previous.notice) noticeChanges += 1;
    });
    repository.rejectNext(new Error('first'));
    repository.rejectNext(new Error('second'));
    store.getState().dispatch(RENAME_A);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    await expect(store.getState().flush()).resolves.toBeUndefined();
    expect(repository.puts).toHaveLength(2);
    expect(putAt(repository, 1).roots).toStrictEqual(putAt(repository, 0).roots);
    expect(store.getState().notice).toBe(SAVE_FAILED);
    expect(noticeChanges).toBe(1);
  });

  it('retries a failed write with the next change', async () => {
    const { store, repository } = saving();
    repository.rejectNext(new Error('first'));
    store.getState().dispatch(RENAME_A);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    store.getState().dispatch(ADD_C);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(repository.puts).toHaveLength(2);
    expect(putAt(repository, 1).roots).toStrictEqual(applied(sampleMap(), [RENAME_A, ADD_C]).roots);
  });

  it('runs a second write while the first is in flight, in start order', async () => {
    const { store, repository } = saving();
    const first = repository.holdNext();
    const second = repository.holdNext();
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    store.getState().dispatch(ADD_C);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

    expect(repository.puts.map((map) => map.roots)).toStrictEqual([
      applied(sampleMap(), [RENAME_A]).roots,
      applied(sampleMap(), [RENAME_A, ADD_C]).roots,
    ]);
    first.resolve();
    await settle();
    expect(store.getState().notice).toBeNull();
    second.reject(new Error('dropped connection'));
    await settle();
    expect(store.getState().notice).toBe(SAVE_FAILED);
  });

  it('keeps a newer session failure visible after an older save succeeds', async () => {
    const { store, repository } = saving();
    const older = repository.holdNext();
    store.getState().dispatch(RENAME_A);
    const firstSave = store.getState().flush();

    repository.rejectNext(new StorageUnauthorizedError());
    store.getState().dispatch(ADD_C);
    await store.getState().flush();
    const latest = applied(sampleMap(), [RENAME_A, ADD_C]).roots;
    expect(repository.puts.map((map) => map.roots)).toStrictEqual([
      applied(sampleMap(), [RENAME_A]).roots,
      latest,
    ]);
    expect(store.getState().notice).toBe(SESSION_EXPIRED);

    older.resolve();
    await firstSave;
    expect(store.getState().notice).toBe(SESSION_EXPIRED);

    await store.getState().flush();
    expect(repository.puts).toHaveLength(3);
    expect(putAt(repository, 2).roots).toStrictEqual(latest);
    expect(store.getState().notice).toBeNull();
  });

  it('preserves a notice unrelated to saving after a successful put', async () => {
    const { store, repository } = saving();
    const notice = '无法导出导图';
    store.getState().showNotice(notice);
    store.getState().dispatch(RENAME_A);
    await store.getState().flush();

    expect(repository.puts).toHaveLength(1);
    expect(putAt(repository, 0).roots).toStrictEqual(applied(sampleMap(), [RENAME_A]).roots);
    expect(store.getState().notice).toBe(notice);
  });

  it('a failed write of the previous map shows "保存失败" after load and is not retried', async () => {
    const { store, repository } = saving();
    const held = repository.holdNext();
    store.getState().dispatch(RENAME_A);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    store.getState().load(otherMap());
    held.reject(new Error('dropped connection'));
    await settle();

    expect(store.getState().notice).toBe(SAVE_FAILED);
    await store.getState().flush();
    vi.advanceTimersByTime(10_000);
    expect(repository.puts).toHaveLength(1);
  });
});

describe('HTTP save failure recovery', () => {
  function httpSaving() {
    const server = new MapFetch();
    const store = createEditorStore({ repository: httpRepository(server) });
    store.getState().load(mapOf(node('r', [node('a'), node('b')])));
    return { server, store };
  }

  it.each([
    { status: 401, notice: SESSION_EXPIRED },
    { status: 500, notice: SAVE_FAILED },
  ])('clears the notice after recovering from HTTP $status', async ({ status, notice }) => {
    const { server, store } = httpSaving();
    store.getState().dispatch({ op: 'update_node', id: 'a', text: '保留的修改' });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      server.respondNext(() => new Response(null, { status }));
      await store.getState().flush();
      expect(store.getState().notice).toBe(notice);
    }
    expect(server.requests).toHaveLength(2);
    await store.getState().flush();
    expect(store.getState().notice).toBeNull();
    expect(server.requests).toHaveLength(3);
    const body = server.requests[2]?.init?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(body) as unknown).toMatchObject({
      map: {
        roots: [
          {
            children: [
              { id: 'a', text: '保留的修改' },
              { id: 'b', text: 'B' },
            ],
          },
        ],
      },
    });
    await store.getState().flush();
    expect(server.requests).toHaveLength(3);
    expect(store.getState().notice).toBeNull();
  });

  it('keeps newer failed edits pending after an older queued save succeeds', async () => {
    const { server, store } = httpSaving();
    const older = heldResult<Response>();
    server.respondNext(() => older.promise);
    store.getState().dispatch({ op: 'update_node', id: 'a', text: '较早的修改' });
    const firstSave = store.getState().flush();
    server.respondNext(() => new Response(null, { status: 401 }));
    store.getState().dispatch({ op: 'update_node', id: 'b', text: '较新的修改' });
    const secondSave = store.getState().flush();
    const requestsBeforeRelease = server.requests.length;
    older.resolve(new Response(null, { status: 204 }));
    await Promise.all([firstSave, secondSave]);
    expect(requestsBeforeRelease).toBe(1);
    expect(server.requests).toHaveLength(2);
    expect(store.getState().notice).toBe(SESSION_EXPIRED);

    await store.getState().flush();
    expect(store.getState().notice).toBeNull();
    expect(server.requests).toHaveLength(3);
    const body = server.requests[2]?.init?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(body) as unknown).toMatchObject({
      map: {
        roots: [
          {
            children: [
              { id: 'a', text: '较早的修改' },
              { id: 'b', text: '较新的修改' },
            ],
          },
        ],
      },
    });
    await store.getState().flush();
    expect(server.requests).toHaveLength(3);
    expect(store.getState().notice).toBeNull();
  });
});
