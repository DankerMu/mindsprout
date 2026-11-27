import { describe, expect, it } from 'vitest';
import { parseTreeOp, type TreeOp } from '../../src/contexts/ai/acl/map';
import type { Provider } from '../../src/contexts/ai/application/provider';
import type { TurnEnd } from '../../src/contexts/ai/application/turn-loop';

// Shared Provider contract (design "Sketch seams under test", proposal "Issue #300 Fixture
// Triage"). Every adapter runs it unchanged: its harness encodes the canonical per-turn inputs
// below into its own wire format, counts the turn requests its transport receives and resolves
// `waiting` once a stalled turn's transport is waiting. A stalled transport settles only through
// the signal the adapter passed to it, so a dropped signal fails as a hang.

interface ToolCall {
  parentId: string;
  children: { id: string; text: string }[];
}

// One model turn: completed add_children inputs in order, then how the turn ended. `stall` is a
// turn whose request never answers until its own signal aborts.
type CanonicalTurn = { calls: ToolCall[]; end: TurnEnd } | 'stall';

export type ProviderScenarioName = 'skeleton' | 'endless' | 'stalled';

export interface ProviderHarness {
  provider: Provider;
  // Turn requests the transport has received so far.
  turnsRequested(): number;
  // Resolves once a stalled turn's transport is waiting on the signal.
  waiting: Promise<void>;
}

const ROOT_ID = 'contract-root';
const SETTLE_MS = 1000;

function call(parentId: string, ...ids: string[]): ToolCall {
  return { parentId, children: ids.map((id) => ({ id, text: `节点 ${id}` })) };
}

const FIRST_LEVEL = ['n1', 'n2', 'n3', 'n4'];
const SKELETON_ROOT_TURN: CanonicalTurn = {
  calls: [call('root', ...FIRST_LEVEL)],
  end: 'tool-use',
};

// Each turn after the expected stop is a valid call, so an adapter that overruns shows an extra
// op and an extra turn request instead of a script error.
export const PROVIDER_SCENARIOS: Readonly<Record<ProviderScenarioName, readonly CanonicalTurn[]>> =
  {
    // Turn 2 completes the skeleton on a tool-use end: only the `complete` stop prevents turn 3.
    skeleton: [
      SKELETON_ROOT_TURN,
      {
        calls: FIRST_LEVEL.map((parent) => call(parent, `${parent}a`, `${parent}b`, `${parent}c`)),
        end: 'tool-use',
      },
      { calls: [call('root', 'n5')], end: 'tool-use' },
    ],
    // b never gets a child, so the skeleton never completes and only the turn limit stops it.
    endless: [
      { calls: [call('root', 'a', 'b')], end: 'tool-use' },
      { calls: [call('a', 'a1')], end: 'tool-use' },
      { calls: [call('a', 'a2')], end: 'tool-use' },
      { calls: [call('a', 'a3')], end: 'tool-use' },
      { calls: [call('b', 'b1')], end: 'tool-use' },
    ],
    stalled: [SKELETON_ROOT_TURN, 'stall'],
  };

function temporaryIds(scenario: ProviderScenarioName): Set<string> {
  const ids = new Set(['root']);
  for (const turn of PROVIDER_SCENARIOS[scenario]) {
    if (turn === 'stall') continue;
    for (const { children } of turn.calls) for (const child of children) ids.add(child.id);
  }
  return ids;
}

function request(signal: AbortSignal = new AbortController().signal) {
  return { topic: '契约测试', rootId: ROOT_ID, signal };
}

async function collect(ops: AsyncIterable<TreeOp>): Promise<TreeOp[]> {
  const out: TreeOp[] = [];
  for await (const op of ops) out.push(op);
  return out;
}

function nodeIds(ops: readonly TreeOp[]): string[] {
  return ops.flatMap((op) =>
    op.op === 'add_children' ? op.children.map((child) => child.id) : [],
  );
}

// Settles like `promise`, or rejects with a named failure after SETTLE_MS; never leaves a timer.
async function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what} did not settle within ${String(SETTLE_MS)} ms`));
    }, SETTLE_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function describeProviderContract(
  name: string,
  makeHarness: (scenario: ProviderScenarioName) => ProviderHarness,
): void {
  describe(`${name} satisfies the Provider contract`, () => {
    it('skeleton: 5 valid ops with fresh distinct ids, stopped by `complete` after 2 turns', async () => {
      const harness = makeHarness('skeleton');

      const ops = await collect(harness.provider.streamOps(request()));

      expect(ops).toHaveLength(5);
      for (const op of ops) expect(parseTreeOp(op)).toStrictEqual(op);
      const ids = nodeIds(ops);
      const temporary = temporaryIds('skeleton');
      expect(ids).toHaveLength(16);
      expect(ids.filter((id) => temporary.has(id))).toStrictEqual([]);
      expect(new Set(ids).size).toBe(ids.length);
      const [first, ...rest] = ops;
      expect(first).toMatchObject({ op: 'add_children', parentId: ROOT_ID });
      // The second turn's calls land under the server ids the first op introduced, in order.
      expect(rest.map((op) => (op.op === 'add_children' ? op.parentId : op.op))).toStrictEqual(
        ids.slice(0, 4),
      );
      expect(harness.turnsRequested()).toBe(2);
    });

    it('endless: the turn limit stops after 4 turns, keeps 4 ops and ends normally', async () => {
      const harness = makeHarness('endless');

      const ops = await collect(harness.provider.streamOps(request()));

      expect(ops).toHaveLength(4);
      expect(harness.turnsRequested()).toBe(4);
    });

    it('stalled: an abort while the transport waits rejects with signal.reason', async () => {
      const harness = makeHarness('stalled');
      const controller = new AbortController();
      const ops = harness.provider.streamOps(request(controller.signal))[Symbol.asyncIterator]();

      const first = await within(ops.next(), 'the first op');
      expect(first.done).toBe(false);
      const pending = ops.next();
      await within(harness.waiting, 'the stalled turn request');
      const reason = new Error('contract abort');
      controller.abort(reason);

      await expect(within(pending, 'the aborted attempt')).rejects.toBe(reason);
      expect(harness.turnsRequested()).toBe(2);
    });
  });
}
