import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentMap,
  expectHistoryError,
  expectUnchanged,
  NOW,
  scriptedIds,
  type Store,
} from '../../../../../tests/support/editor-store';
import { FakeGenerateSource, type FakeRun } from '../../../../../tests/support/generate-source';
import {
  entriesOf,
  mapOf,
  node,
  // Applies any op list in order through the checked apply helper — the expected-map oracle here.
  undo as applied,
} from '../../../../../tests/support/map-domain';
import { RecordingRepository } from '../../../../../tests/support/map-repository-stub';
import { GenerateError, type GenerateErrorCode } from '../../domain/errors';
import type { GenerateSource } from '../../domain/generate-source';
import type { TreeOp } from '../../domain/tree-op';
import type { MindMap, NodeId } from '../../domain/types';
import {
  AUTOSAVE_DELAY_MS,
  createEditorStore,
  EditorStoreError,
  SESSION_EXPIRED,
  type EditorState,
  type EditorStoreErrorCode,
} from './editor-store';

// "Issue #308 Fixture Triage" and spec topic-generation: the store's generate(topic) action, its
// session and the generating lock, through the createEditorStore public API over the real History
// and applyOp, with the test-driven FakeGenerateSource (tests/support/generate-source.ts). Expected
// maps come from the checked applyOp helper; notice texts are copied from the spec table.

const DEFAULT_TITLE = '新导图';
const TOPIC = '学习 TypeScript';
const INVALID_OUTPUT_FAILED = '生成失败：AI 返回的内容无法使用，请重试';
const FAILURES: [Exclude<GenerateErrorCode, 'ai-unavailable' | 'unauthenticated'>, string][] = [
  ['timeout', '生成超时，请重试'],
  ['provider-error', 'AI 服务出错，请稍后重试'],
  ['invalid-output', 'AI 返回的内容无法使用，请重试'],
  ['refused', 'AI 拒绝了这个主题，请换一个主题'],
  ['network', '网络连接失败，请检查网络后重试'],
];

function children(parentId: NodeId, ids: string[]): TreeOp {
  return {
    op: 'add_children',
    parentId,
    children: ids.map((id) => ({ id, text: id.toUpperCase() })),
  };
}

const FIRST_LEVEL = ['p1', 'p2', 'p3', 'p4'];
// The root call (4 first-level nodes), then 3 children under each: 16 non-root nodes.
const ROOT_OP = children('r', FIRST_LEVEL);
const SKELETON: TreeOp[] = [
  ROOT_OP,
  ...FIRST_LEVEL.map((id) => children(id, [`${id}a`, `${id}b`, `${id}c`])),
];
const UNKNOWN_PARENT = children('missing', ['z']);

function rootText(text: string): TreeOp {
  return { op: 'update_node', id: 'r', text };
}

// An empty map: only the primary root r (text "R").
function emptyMap(title = DEFAULT_TITLE): MindMap {
  return { ...mapOf(node('r')), title };
}

function otherMap(): MindMap {
  return { ...mapOf(node('x', [node('y')])), id: 'm2', title: '另一张' };
}

interface Generating {
  store: Store;
  source: FakeGenerateSource;
  before: MindMap;
}

function setup(map: MindMap = emptyMap(), repository?: RecordingRepository): Generating {
  const source = new FakeGenerateSource();
  const store = createEditorStore({
    now: () => new Date(NOW),
    newId: scriptedIds('n1'),
    generateSource: source,
    ...(repository === undefined ? {} : { repository }),
  });
  store.getState().load(map);
  return { store, source, before: currentMap(store) };
}

// Starts a generation of TOPIC and returns its session promise with the fake's run.
function start(setupResult: Generating, topic = TOPIC): { done: Promise<void>; run: FakeRun } {
  const done = setupResult.store.getState().generate(topic);
  return { done, run: setupResult.source.run(setupResult.source.runs.length - 1) };
}

async function pushAll(run: FakeRun, ops: readonly TreeOp[]): Promise<void> {
  for (const op of ops) await run.push(op);
}

function nonRootCount(map: MindMap): number {
  return entriesOf(map).length - 1;
}

function expectEnded(store: Store, notice: string | null): void {
  const { generating, groupOpen } = store.getState();
  expect({ generating, groupOpen, notice: store.getState().notice }).toStrictEqual({
    generating: false,
    groupOpen: false,
    notice,
  });
}

function expectStoreError(error: unknown, code: EditorStoreErrorCode): void {
  expect(error).toBeInstanceOf(EditorStoreError);
  expect((error as EditorStoreError).code).toBe(code);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('nothing changes before the first op', () => {
  it('Root text and title: the trimmed topic becomes the root text and the default title', async () => {
    const g = setup();
    const { done, run } = start(g, `  ${TOPIC}  `);
    expect(run.input).toStrictEqual({ topic: TOPIC, rootId: 'r' });

    await run.push(ROOT_OP);
    const map = currentMap(g.store);
    expect(map.roots).toStrictEqual(applied(g.before, [rootText(TOPIC), ROOT_OP]).roots);
    expect(map.title).toBe(TOPIC);
    run.finish();
    await done;
    expectEnded(g.store, null);
  });

  it('Custom title kept: a renamed map keeps its title and only the root text changes', async () => {
    const g = setup(emptyMap('我的计划'));
    const { done, run } = start(g);
    await run.push(ROOT_OP);
    run.finish();
    await done;

    expect(currentMap(g.store).title).toBe('我的计划');
    expect(currentMap(g.store).roots[0]?.text).toBe(TOPIC);
  });

  it('leaves the map, title and undo untouched while the source has yielded nothing', async () => {
    const g = setup();
    const { done, run } = start(g);
    const state = g.store.getState();
    expect(state.map).toBe(g.before);
    expect(state.map?.title).toBe(DEFAULT_TITLE);
    expect({
      canUndo: state.canUndo,
      generating: state.generating,
      groupOpen: state.groupOpen,
    }).toStrictEqual({ canUndo: false, generating: true, groupOpen: true });
    run.finish();
    await done;
  });

  it.each([
    ['stopGeneration() before any op', 'stop'],
    ['a normal return with zero ops', 'finish'],
  ] as const)('a zero-op end (%s) changes nothing and saves nothing', async (_, end) => {
    vi.useFakeTimers();
    const repository = new RecordingRepository();
    const g = setup(emptyMap(), repository);
    const { done, run } = start(g);
    if (end === 'stop') g.store.getState().stopGeneration();
    run.finish();
    await done;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);

    expect(g.store.getState().map).toBe(g.before);
    expect(g.store.getState().canUndo).toBe(false);
    expectEnded(g.store, null);
    expect(repository.puts).toHaveLength(0);
  });

  it('Failure before the first op: invalid-output keeps the map and shows the failure notice', async () => {
    const g = setup();
    const { done, run } = start(g);
    run.fail(new GenerateError('invalid-output'));
    await done;

    expect(g.store.getState().map).toBe(g.before);
    expect(g.store.getState().canUndo).toBe(false);
    expectEnded(g.store, INVALID_OUTPUT_FAILED);
  });
});

describe('a generation is one undo step', () => {
  it('Undo completed generation: one undo leaves only the root with its old text, redo restores', async () => {
    const g = setup();
    const { done, run } = start(g);
    await pushAll(run, SKELETON);
    run.finish();
    await done;
    const generated = currentMap(g.store);
    expect(nonRootCount(generated)).toBe(16);

    g.store.getState().undo();
    expect(currentMap(g.store).roots).toStrictEqual(g.before.roots);
    expect(g.store.getState().canUndo).toBe(false);
    g.store.getState().redo();
    expect(currentMap(g.store).roots).toStrictEqual(generated.roots);
  });

  it('Undo partial generation: two ops then Stop, one undo restores the pre-generation tree', async () => {
    const g = setup();
    const { done, run } = start(g);
    await pushAll(run, SKELETON.slice(0, 2));
    g.store.getState().stopGeneration();
    run.finish();
    await done;

    g.store.getState().undo();
    expect(currentMap(g.store).roots).toStrictEqual(g.before.roots);
    expect(g.store.getState().canUndo).toBe(false);
  });
});

describe('refusals (spec "Double submit", "Invalid topic cannot be submitted")', () => {
  it('Double submit: a second generate throws generating synchronously and calls no source', async () => {
    const g = setup();
    const { done, run } = start(g);
    expectStoreError(
      expectUnchanged(g.store, (state) => void state.generate('again')),
      'generating',
    );
    expect(g.source.runs).toHaveLength(1);
    run.finish();
    await done;
  });

  const refusals: [string, EditorStoreErrorCode, MindMap, string][] = [
    ['a root with a child', 'not-empty', mapOf(node('r', [node('a')])), TOPIC],
    [
      'a floating root',
      'not-empty',
      mapOf(node('r'), node('f', [], { position: { x: 1, y: 2 } })),
      TOPIC,
    ],
    ['a blank topic', 'invalid-topic', emptyMap(), '   '],
    ['201 ASCII units', 'invalid-topic', emptyMap(), 'a'.repeat(201)],
    ['101 astral characters (202 units)', 'invalid-topic', emptyMap(), '𐀀'.repeat(101)],
  ];

  it.each(refusals)('refuses %s with %s and calls no source', (_, code, map, topic) => {
    const g = setup(map);
    expectStoreError(
      expectUnchanged(g.store, (state) => void state.generate(topic)),
      code,
    );
    expect(g.source.runs).toHaveLength(0);
  });

  it.each([
    ['200 ASCII units', 'a'.repeat(200), 'a'.repeat(200)],
    ['100 astral characters', '𐀀'.repeat(100), '𐀀'.repeat(100)],
    ['a padded topic whose trimmed length is 200', ` ${'a'.repeat(200)}  `, 'a'.repeat(200)],
  ])('accepts %s and sends the trimmed topic', async (_, topic, sent) => {
    const g = setup();
    const { done, run } = start(g, topic);
    expect(run.input.topic).toBe(sent);
    run.finish();
    await done;
  });

  it('refuses no-source on a store without a generate source', () => {
    const store = createEditorStore();
    store.getState().load(emptyMap());
    expectStoreError(
      expectUnchanged(store, (state) => void state.generate(TOPIC)),
      'no-source',
    );
  });

  it('refuses no-map before anything else', () => {
    const g = setup();
    const store = createEditorStore({ generateSource: g.source });
    expectStoreError(
      expectUnchanged(store, (state) => void state.generate(TOPIC)),
      'no-map',
    );
  });

  it('refuses already-editing while a rename edit is open', () => {
    const g = setup();
    g.store.getState().startEdit('r');
    expectStoreError(
      expectUnchanged(g.store, (state) => void state.generate(TOPIC)),
      'already-editing',
    );
    expect(g.source.runs).toHaveLength(0);
  });

  // Not in the fixture's refusal list: an explicitly opened store group makes History refuse the
  // generate group; the refusal must leave no lock behind.
  it('refuses with group-open, leaving no lock, while an explicit store group is open', () => {
    const g = setup();
    g.store.getState().beginGroup('g');
    expectHistoryError(
      expectUnchanged(g.store, (state) => void state.generate(TOPIC)),
      'group-open',
    );
    expect(g.store.getState().generating).toBe(false);
    expect(g.source.runs).toHaveLength(0);
  });
});

describe('Reducer rejection', () => {
  it('reverts the tree and the title, aborts before return(), and shows the failure', async () => {
    const g = setup();
    const { done, run } = start(g);
    await run.push(ROOT_OP);
    await run.push(UNKNOWN_PARENT);
    await done;

    expect(currentMap(g.store).roots).toStrictEqual(g.before.roots);
    expect(currentMap(g.store).title).toBe(DEFAULT_TITLE);
    expect(g.store.getState().canUndo).toBe(false);
    expect(run.abortedAtReturn).toBe(true);
    expectEnded(g.store, INVALID_OUTPUT_FAILED);
    const map = currentMap(g.store);
    g.store.getState().undo();
    expect(g.store.getState().map).toBe(map);
  });

  it('reverts the root text and the rename when the very first source op is rejected', async () => {
    const g = setup();
    const { done, run } = start(g);
    await run.push(UNKNOWN_PARENT);
    await done;

    expect(currentMap(g.store).roots).toStrictEqual(g.before.roots);
    expect(currentMap(g.store).title).toBe(DEFAULT_TITLE);
    expect(g.store.getState().canUndo).toBe(false);
    expectEnded(g.store, INVALID_OUTPUT_FAILED);
  });

  it('keeps a custom title and a title the user changed meanwhile', async () => {
    const custom = setup(emptyMap('我的计划'));
    const first = start(custom);
    await first.run.push(UNKNOWN_PARENT);
    await first.done;
    expect(currentMap(custom.store).title).toBe('我的计划');

    const changed = setup();
    const second = start(changed);
    await second.run.push(ROOT_OP);
    changed.store.getState().rename('用户改的');
    await second.run.push(UNKNOWN_PARENT);
    await second.done;
    expect(currentMap(changed.store).title).toBe('用户改的');
  });
});

describe('failure notices (spec "Failure notices use fixed texts")', () => {
  it('AI unavailable: no notice, an unchanged map, and aiUnavailable survives a load', async () => {
    const g = setup();
    const { done, run } = start(g);
    run.fail(new GenerateError('ai-unavailable'));
    await done;

    expect(g.store.getState().aiUnavailable).toBe(true);
    expect(g.store.getState().map).toBe(g.before);
    expect(g.store.getState().canUndo).toBe(false);
    expectEnded(g.store, null);
    g.store.getState().load(otherMap());
    expect(g.store.getState().aiUnavailable).toBe(true);
  });

  it('Session expired at submit: unauthenticated shows SESSION_EXPIRED and keeps the map', async () => {
    const g = setup();
    const { done, run } = start(g);
    run.fail(new GenerateError('unauthenticated'));
    await done;

    expect(g.store.getState().map).toBe(g.before);
    expectEnded(g.store, SESSION_EXPIRED);
    expect(g.store.getState().aiUnavailable).toBe(false);
  });

  it('Network failure: network before any op reads the 生成失败 network text', async () => {
    const g = setup();
    const { done, run } = start(g);
    run.fail(new GenerateError('network'));
    await done;
    expectEnded(g.store, '生成失败：网络连接失败，请检查网络后重试');
  });

  it.each(
    FAILURES.flatMap(([code, text]) => [
      [code, 0, `生成失败：${text}`] as const,
      [code, 1, `生成中断：${text}`] as const,
    ]),
  )('%s after %i ops reads %s', async (code, ops, notice) => {
    const g = setup();
    const { done, run } = start(g);
    await pushAll(run, SKELETON.slice(0, ops));
    run.fail(new GenerateError(code));
    await done;
    expectEnded(g.store, notice);
  });
});

describe('Stop', () => {
  async function stoppedAfterFirstOp(): Promise<
    Generating & { done: Promise<void>; run: FakeRun }
  > {
    const g = setup();
    const { done, run } = start(g);
    await run.push(ROOT_OP);
    g.store.getState().stopGeneration();
    return { ...g, done, run };
  }

  it('ends synchronously after the first op, keeps its nodes and aborts the signal', async () => {
    const { store, before, done, run } = await stoppedAfterFirstOp();
    expectEnded(store, null);
    expect(currentMap(store).roots).toStrictEqual(
      applied(before, [rootText(TOPIC), ROOT_OP]).roots,
    );
    expect(run.signal.aborted).toBe(true);
    run.finish();
    await done;
  });

  it('does not dispatch an op the source yields after Stop', async () => {
    const { store, done, run } = await stoppedAfterFirstOp();
    const map = currentMap(store);
    await run.push(children('p1', ['late']));
    await done;
    expect(store.getState().map).toBe(map);
  });

  it('shows no notice for a GenerateError the source throws after Stop', async () => {
    const { store, done, run } = await stoppedAfterFirstOp();
    run.fail(new GenerateError('provider-error'));
    await done;
    expectEnded(store, null);
  });

  it('does nothing when no generation runs', () => {
    const g = setup();
    const before = g.store.getState();
    before.stopGeneration();
    expect(g.store.getState()).toBe(before);
  });
});

describe('Mid-stream error', () => {
  it('keeps the 7 nodes of two ops, reads 生成中断, and one undo restores the tree', async () => {
    const g = setup();
    const { done, run } = start(g);
    await pushAll(run, SKELETON.slice(0, 2));
    run.fail(new GenerateError('provider-error'));
    await done;

    expect(nonRootCount(currentMap(g.store))).toBe(7);
    expectEnded(g.store, '生成中断：AI 服务出错，请稍后重试');
    g.store.getState().undo();
    expect(currentMap(g.store).roots).toStrictEqual(g.before.roots);
  });
});

describe('restart after Stop: a stopped session never touches the next one', () => {
  it.each([
    ['returns', undefined],
    ['throws a GenerateError', new GenerateError('network')],
    ['throws a plain Error', new Error('defect')],
  ])('the first source %s after the second generate started', async (_, error) => {
    const g = setup();
    const first = start(g);
    g.store.getState().stopGeneration();
    const second = start(g);
    if (error === undefined) first.run.finish();
    else first.run.fail(error);
    await first.done;

    const { generating, groupOpen, notice } = g.store.getState();
    expect({ generating, groupOpen, notice }).toStrictEqual({
      generating: true,
      groupOpen: true,
      notice: null,
    });
    second.run.finish();
    await second.done;
  });

  it('gates a late op of the first source by the session, not by generating', async () => {
    const g = setup();
    const first = start(g);
    g.store.getState().stopGeneration();
    const second = start(g);
    await first.run.push(ROOT_OP);
    await first.done;

    expect(g.store.getState().map).toBe(g.before);
    expect(currentMap(g.store).roots[0]?.text).toBe('R');
    expect(currentMap(g.store).title).toBe(DEFAULT_TITLE);
    expect(second.run.signal.aborted).toBe(false);
    second.run.finish();
    await second.done;
  });
});

describe('stale generation notice', () => {
  async function failedWithNetwork(): Promise<Generating> {
    const g = setup();
    const { done, run } = start(g);
    run.fail(new GenerateError('network'));
    await done;
    expect(g.store.getState().notice).toBe('生成失败：网络连接失败，请检查网络后重试');
    return g;
  }

  it('a retry that completes clears the previous generation notice', async () => {
    const g = await failedWithNetwork();
    const { done, run } = start(g);
    await run.push(ROOT_OP);
    run.finish();
    await done;
    expect(g.store.getState().notice).toBeNull();
  });

  it('a retry that is stopped clears the previous generation notice', async () => {
    const g = await failedWithNetwork();
    const { done, run } = start(g);
    g.store.getState().stopGeneration();
    run.finish();
    await done;
    expect(g.store.getState().notice).toBeNull();
  });

  it('keeps a save notice at start', async () => {
    const g = setup();
    g.store.getState().showNotice('保存失败');
    const { done, run } = start(g);
    expect(g.store.getState().notice).toBe('保存失败');
    run.finish();
    await done;
    expect(g.store.getState().notice).toBe('保存失败');
  });

  it('clears a SESSION_EXPIRED equal to the one a generation set, even when set again later', async () => {
    const g = setup();
    const first = start(g);
    first.run.fail(new GenerateError('unauthenticated'));
    await first.done;
    g.store.getState().clearNotice();
    g.store.getState().showNotice(SESSION_EXPIRED);
    const second = start(g);
    expect(g.store.getState().notice).toBeNull();
    second.run.finish();
    await second.done;
  });
});

describe('load during a generation', () => {
  it('aborts the session, unlocks, and never applies a late op to the loaded map', async () => {
    const g = setup();
    const { done, run } = start(g);
    // Another empty map with the same root id: a leaked session's late op would apply cleanly.
    const other: MindMap = { ...emptyMap(), id: 'm2', title: '另一张' };
    g.store.getState().load(other);

    expect(run.signal.aborted).toBe(true);
    expectEnded(g.store, null);
    await run.push(ROOT_OP);
    run.finish();
    await done;
    expect(g.store.getState().map).toBe(other);
    expect(g.store.getState().canUndo).toBe(false);
    expectEnded(g.store, null);
  });
});

describe('defects', () => {
  it('rethrows a plain Error from the session promise and leaves no lock', async () => {
    const g = setup();
    const { done, run } = start(g);
    const defect = new Error('source defect');
    run.fail(defect);
    await expect(done).rejects.toBe(defect);
    expectEnded(g.store, null);
  });

  it('takes the defect path when the source throws synchronously', async () => {
    const defect = new Error('sync defect');
    const throwing: GenerateSource = {
      generate: () => {
        throw defect;
      },
    };
    const store = createEditorStore({ generateSource: throwing });
    store.getState().load(emptyMap());
    await expect(store.getState().generate(TOPIC)).rejects.toBe(defect);
    expectEnded(store, null);
  });
});

describe('lock (spec "Tree editing is locked while generating")', () => {
  // Each listed action: the lock must come before its own preconditions (no edit is open here).
  const refused: Record<string, (state: EditorState) => void> = {
    dispatch(s) {
      s.dispatch(rootText('x'));
    },
    undo(s) {
      s.undo();
    },
    redo(s) {
      s.redo();
    },
    beginGroup(s) {
      s.beginGroup('g');
    },
    endGroup(s) {
      s.endGroup();
    },
    cancelGroup(s) {
      s.cancelGroup();
    },
    runGrouped(s) {
      s.runGrouped('g', () => {
        s.dispatch(rootText('x'));
      });
    },
    createNode(s) {
      s.createNode('r');
    },
    deleteSelection(s) {
      s.deleteSelection();
    },
    startEdit(s) {
      s.startEdit('r');
    },
    commitTitle(s) {
      s.commitTitle('x');
    },
    cancelEdit(s) {
      s.cancelEdit();
    },
  };

  it.each(Object.entries(refused))(
    '%s refuses with generating and changes nothing',
    async (_, act) => {
      const g = setup();
      const { done, run } = start(g);
      await run.push(ROOT_OP);
      g.store.getState().select('p1');
      expectStoreError(
        expectUnchanged(g.store, (state) => {
          act(state);
        }),
        'generating',
      );
      run.finish();
      await done;
    },
  );

  it('selection, menu, notices, rename, flush and Stop stay available', async () => {
    const g = setup();
    const { done, run } = start(g);
    await run.push(ROOT_OP);
    const state = (): EditorState => g.store.getState();
    state().select('p1');
    state().toggleSelect('p2');
    expect(state().selectedIds).toStrictEqual(['p1', 'p2']);
    state().setSelection(['p3']);
    expect(state().topmostSelected()).toStrictEqual(['p3']);
    state().selectAll();
    state().clearSelection();
    state().openMenu('p1');
    expect(state().menuTargetId).toBe('p1');
    state().closeMenu();
    state().showNotice('提示');
    state().clearNotice();
    state().rename('新名字');
    expect(currentMap(g.store).title).toBe('新名字');
    await state().flush();
    expect(state().generating).toBe(true);
    state().stopGeneration();
    expect(state().generating).toBe(false);
    run.finish();
    await done;
  });
});

describe('Saved after completion (autosave holds while generating)', () => {
  it('puts nothing while generating and the generated map once after it ends', async () => {
    vi.useFakeTimers();
    const repository = new RecordingRepository();
    const g = setup(emptyMap(), repository);
    const { done, run } = start(g);
    await pushAll(run, SKELETON.slice(0, 2));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(repository.puts).toHaveLength(0);

    await pushAll(run, SKELETON.slice(2));
    run.finish();
    await done;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(repository.puts).toHaveLength(1);
    expect(repository.puts[0]?.roots).toStrictEqual(currentMap(g.store).roots);
    expect(repository.puts[0]?.title).toBe(TOPIC);
  });

  it('stopGeneration() then flush() puts the partial map', async () => {
    const repository = new RecordingRepository();
    const g = setup(emptyMap(), repository);
    const { done, run } = start(g);
    await run.push(ROOT_OP);
    g.store.getState().stopGeneration();
    await g.store.getState().flush();
    run.finish();
    await done;

    expect(repository.puts).toHaveLength(1);
    expect(repository.puts[0]?.roots).toStrictEqual(
      applied(g.before, [rootText(TOPIC), ROOT_OP]).roots,
    );
  });
});
