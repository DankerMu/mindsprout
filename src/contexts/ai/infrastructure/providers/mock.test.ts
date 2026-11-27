import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeProviderContract,
  PROVIDER_SCENARIOS,
  type ProviderHarness,
  type ProviderScenarioName,
} from '../../../../../tests/support/provider-contract';
import type { TreeOp } from '../../acl/map';
import {
  ProviderOutputError,
  ProviderRefusedError,
  ProviderTransportError,
} from '../../domain/errors';
import { createMockProvider, type MockScript, mockScriptFor } from './mock';

const ROOT_ID = 'primary-root';

function counterIds(prefix: string) {
  let issued = 0;
  return () => `${prefix}${String((issued += 1))}`;
}

// Mock harness: the injected script replays the canonical inputs, counts each turn the loop
// requests, and turns a stalled turn into a wait step whose onWait resolves `waiting`.
function mockHarness(scenario: ProviderScenarioName): ProviderHarness {
  let turns = 0;
  const box: { release?: () => void } = {};
  const waiting = new Promise<void>((resolve) => {
    box.release = resolve;
  });
  const script: MockScript = (turn) => {
    turns += 1;
    const canonical = PROVIDER_SCENARIOS[scenario][turn - 1];
    if (canonical === undefined) throw new Error(`turn ${String(turn)} is not in ${scenario}`);
    if (canonical === 'stall') {
      return { steps: [{ type: 'wait', onWait: () => box.release?.() }], end: 'tool-use' };
    }
    const steps = canonical.calls.map((input) => ({ type: 'tool-input' as const, input }));
    return { steps, end: canonical.end };
  };
  return {
    provider: createMockProvider({ idFactory: counterIds('srv-'), delayMs: 0, script }),
    turnsRequested: () => turns,
    waiting,
  };
}

describeProviderContract('mock', mockHarness);

function request(topic: string, signal: AbortSignal = new AbortController().signal) {
  return { topic, rootId: ROOT_ID, signal };
}

// Drains an attempt, keeping the ops emitted before it settled and how it settled.
async function attempt(ops: AsyncIterable<TreeOp>) {
  const emitted: TreeOp[] = [];
  try {
    for await (const op of ops) emitted.push(op);
    return { emitted, error: undefined };
  } catch (error) {
    return { emitted, error };
  }
}

function children(op: TreeOp | undefined) {
  if (op?.op !== 'add_children') throw new Error('expected an add_children op');
  return op.children;
}

// Rewrites every id to its first-seen index so two runs compare by texts and tree shape only.
function shapeOf(ops: readonly TreeOp[]) {
  const index = new Map<string, number>([[ROOT_ID, 0]]);
  const local = (id: string) => {
    if (!index.has(id)) index.set(id, index.size);
    return index.get(id);
  };
  return ops.map((op) => ({
    parent: op.op === 'add_children' ? local(op.parentId) : undefined,
    children: children(op).map((child) => ({ id: local(child.id), text: child.text })),
  }));
}

describe('mock provider: default script', () => {
  it('Deterministic skeleton: two runs give 5 ops, 16 nodes, same texts and shape, new ids', async () => {
    const provider = createMockProvider({ idFactory: counterIds('id-'), delayMs: 0 });

    const one = await attempt(provider.streamOps(request('学习 TypeScript')));
    const two = await attempt(provider.streamOps(request('学习 TypeScript')));

    expect(one.error).toBeUndefined();
    expect(two.error).toBeUndefined();
    expect(one.emitted).toHaveLength(5);
    const ids = (ops: TreeOp[]) => ops.flatMap((op) => children(op).map((child) => child.id));
    expect(ids(one.emitted)).toHaveLength(16);
    expect(ids(two.emitted).filter((id) => ids(one.emitted).includes(id))).toStrictEqual([]);
    expect(shapeOf(two.emitted)).toStrictEqual(shapeOf(one.emitted));
    const [rootOp, ...firstLevelOps] = one.emitted;
    expect(rootOp).toMatchObject({ parentId: ROOT_ID });
    expect(children(rootOp)).toHaveLength(4);
    expect(firstLevelOps.map((op) => (op.op === 'add_children' ? op.parentId : ''))).toStrictEqual(
      children(rootOp).map((child) => child.id),
    );
    for (const op of firstLevelOps) expect(children(op)).toHaveLength(3);
    const texts = one.emitted.flatMap((op) => children(op).map((child) => child.text));
    expect(new Set(texts).size).toBe(16);
  });

  it('gives an unreserved topic the same skeleton whatever the topic says', async () => {
    const provider = createMockProvider({ idFactory: counterIds('id-'), delayMs: 0 });

    const typescript = await attempt(provider.streamOps(request('学习 TypeScript')));
    const other = await attempt(provider.streamOps(request('mock:unknown')));

    expect(shapeOf(other.emitted)).toStrictEqual(shapeOf(typescript.emitted));
  });

  it('ends turns 1 and 2 on tool use with a natural turn 3 available, so `complete` stops it', () => {
    const script = mockScriptFor('学习 TypeScript');

    expect([script(1).end, script(2).end]).toStrictEqual(['tool-use', 'tool-use']);
    expect(script(3)).toStrictEqual({ steps: [], end: 'natural' });
  });
});

describe('mock provider: reserved topics', () => {
  it('Scripted mid-stream error: mock:error-after-2 emits 2 ops (7 nodes), then a transport error', async () => {
    const provider = createMockProvider({ idFactory: counterIds('id-'), delayMs: 0 });

    const result = await attempt(provider.streamOps(request('mock:error-after-2')));

    expect(result.emitted).toHaveLength(2);
    expect(result.emitted.flatMap((op) => children(op))).toHaveLength(7);
    expect(result.error).toBeInstanceOf(ProviderTransportError);
    expect(result.error).toMatchObject({ code: 'provider-error' });
    expect((result.error as Error).message).not.toContain('mock:');
  });

  it('mock:invalid-first gives invalid output on each of two fresh attempts', async () => {
    const provider = createMockProvider({ idFactory: counterIds('id-'), delayMs: 0 });

    const one = await attempt(provider.streamOps(request('mock:invalid-first')));
    const two = await attempt(provider.streamOps(request('mock:invalid-first')));

    for (const result of [one, two]) {
      expect(result.emitted).toStrictEqual([]);
      expect(result.error).toBeInstanceOf(ProviderOutputError);
      expect(result.error).toMatchObject({ code: 'invalid-output' });
    }
  });

  it('mock:refused refuses with zero ops', async () => {
    const provider = createMockProvider({ idFactory: counterIds('id-'), delayMs: 0 });

    const result = await attempt(provider.streamOps(request('mock:refused')));

    expect(result.emitted).toStrictEqual([]);
    expect(result.error).toBeInstanceOf(ProviderRefusedError);
    expect(result.error).toMatchObject({ code: 'refused' });
    expect((result.error as Error).message).not.toContain('mock:');
  });

  it('builds a fresh error object for every attempt', async () => {
    const provider = createMockProvider({ idFactory: counterIds('id-'), delayMs: 0 });

    const one = await attempt(provider.streamOps(request('mock:refused')));
    const two = await attempt(provider.streamOps(request('mock:refused')));

    expect(two.error).not.toBe(one.error);
  });
});

describe('mock provider: per-op delay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('awaits the injected delay before each op', async () => {
    vi.useFakeTimers();
    const provider = createMockProvider({ idFactory: counterIds('id-'), delayMs: 150 });
    const ops = provider.streamOps(request('学习 TypeScript'))[Symbol.asyncIterator]();
    let settled = 0;

    const first = ops.next().then((step) => {
      settled += 1;
      return step;
    });
    await vi.advanceTimersByTimeAsync(149);
    expect(settled).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect((await first).done).toBe(false);
    const second = ops.next().then(() => (settled += 1));
    await vi.advanceTimersByTimeAsync(149);
    expect(settled).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(settled).toBe(2);
  });

  it('rejects with signal.reason on an abort during the delay, without waiting it out', async () => {
    vi.useFakeTimers();
    const provider = createMockProvider({ idFactory: counterIds('id-'), delayMs: 150 });
    const controller = new AbortController();
    const ops = provider.streamOps(request('学习 TypeScript', controller.signal));
    const pending = ops[Symbol.asyncIterator]().next();
    await vi.advanceTimersByTimeAsync(50);
    const reason = new Error('stop');

    const outcome = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await outcome;

    expect(vi.getTimerCount()).toBe(0);
  });
});
