import { describe, expect, it } from 'vitest';
import type { TreeOp } from '../acl/map';
import { ProviderOutputError, ProviderTransportError } from '../domain/errors';
import { type GenerationCaps, PRODUCTION_CAPS } from '../domain/generate-tool';
import { runTurnLoop, type TurnEnd, type TurnItem } from './turn-loop';

const ROOT_ID = 'primary-root';

type RunTurn = (turn: number) => AsyncIterator<TurnItem, TurnEnd>;

// One scripted turn: tool inputs in order, then the end reason. `hook.run` runs ahead of input
// `hook.at` (or ahead of the end when `at` equals the input count), so a turn can block or abort.
interface ScriptedTurn {
  inputs: unknown[];
  end: TurnEnd;
  hook?: { at: number; run: () => Promise<void> | void };
}

// A model call: `add_children` under parentId, each child's text derived from its temporary id.
function call(parentId: string, ...ids: string[]) {
  return { parentId, children: ids.map((id) => ({ id, text: `text ${id}` })) };
}

// The expected op: [server id, temporary id] pairs under a server parent id.
function addChildren(parentId: string, ...children: [serverId: string, tempId: string][]): TreeOp {
  return {
    op: 'add_children',
    parentId,
    children: children.map(([id, tempId]) => ({ id, text: `text ${tempId}` })),
  };
}

// Fake adapter: records each runTurn(turn) call and each return() the loop sends to a turn. The
// recording return() lives on a wrapper, so a turn that ends on its own records nothing.
function script(turns: ScriptedTurn[]) {
  const calls: number[] = [];
  const returned: number[] = [];
  const runTurn: RunTurn = (turn) => {
    calls.push(turn);
    const scripted = turns[turn - 1];
    if (scripted === undefined) throw new Error(`turn ${String(turn)} was not scripted`);
    const body = (async function* () {
      for (const [index, input] of scripted.inputs.entries()) {
        if (scripted.hook?.at === index) await scripted.hook.run();
        yield { type: 'tool-input' as const, input };
      }
      if (scripted.hook?.at === scripted.inputs.length) await scripted.hook.run();
      return scripted.end;
    })();
    return {
      next: () => body.next(),
      return: async () => {
        returned.push(turn);
        return body.return('natural');
      },
    };
  };
  return { calls, returned, runTurn };
}

function loop(
  runTurn: RunTurn,
  options: { signal?: AbortSignal; caps?: GenerationCaps; maxTurns?: number } = {},
) {
  let issued = 0;
  const signal = options.signal ?? new AbortController().signal;
  return runTurnLoop({
    request: { topic: 'topic', rootId: ROOT_ID, signal },
    idFactory: () => `s${String((issued += 1))}`,
    caps: options.caps ?? PRODUCTION_CAPS,
    runTurn,
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
  });
}

async function collect(ops: AsyncIterable<TreeOp>): Promise<TreeOp[]> {
  const out: TreeOp[] = [];
  for await (const op of ops) out.push(op);
  return out;
}

// ES2022 lacks Promise.withResolvers.
function deferred() {
  const box: { resolve?: () => void } = {};
  const promise = new Promise<void>((resolve) => {
    box.resolve = resolve;
  });
  return { promise, release: () => box.resolve?.() };
}

describe('turn loop: stopping', () => {
  it('Two-turn skeleton: ops of both turns are yielded and no third turn is requested', async () => {
    const fake = script([
      { inputs: [call('root', 'a', 'b')], end: 'tool-use' },
      { inputs: [call('a', 'c'), call('b', 'd')], end: 'tool-use' },
      { inputs: [call('c', 'e')], end: 'tool-use' },
    ]);

    const ops = await collect(loop(fake.runTurn));

    expect(ops).toStrictEqual([
      addChildren(ROOT_ID, ['s1', 'a'], ['s2', 'b']),
      addChildren('s1', ['s3', 'c']),
      addChildren('s2', ['s4', 'd']),
    ]);
    expect(fake.calls).toStrictEqual([1, 2]);
    expect(fake.returned).toStrictEqual([]);
  });

  it('Turn limit: exactly 4 turns run, all ops are kept and the attempt ends normally', async () => {
    // b never receives a child, so the skeleton is never complete and every turn asks for more.
    const fake = script([
      { inputs: [call('root', 'a', 'b')], end: 'tool-use' },
      { inputs: [call('a', 'c')], end: 'tool-use' },
      { inputs: [call('a', 'd')], end: 'tool-use' },
      { inputs: [call('a', 'e')], end: 'tool-use' },
      { inputs: [call('b', 'f')], end: 'tool-use' },
    ]);

    const ops = await collect(loop(fake.runTurn));

    expect(ops).toStrictEqual([
      addChildren(ROOT_ID, ['s1', 'a'], ['s2', 'b']),
      addChildren('s1', ['s3', 'c']),
      addChildren('s1', ['s4', 'd']),
      addChildren('s1', ['s5', 'e']),
    ]);
    expect(fake.calls).toStrictEqual([1, 2, 3, 4]);
    expect(fake.returned).toStrictEqual([]);
  });

  it('honours an explicit maxTurns', async () => {
    const fake = script([
      { inputs: [call('root', 'a', 'b')], end: 'tool-use' },
      { inputs: [call('a', 'c')], end: 'tool-use' },
      { inputs: [call('a', 'd')], end: 'tool-use' },
    ]);

    const ops = await collect(loop(fake.runTurn, { maxTurns: 2 }));

    expect(ops).toHaveLength(2);
    expect(fake.calls).toStrictEqual([1, 2]);
  });

  it('a natural end after ops stops without requesting another turn', async () => {
    const fake = script([
      { inputs: [call('root', 'a')], end: 'natural' },
      { inputs: [call('a', 'b')], end: 'tool-use' },
    ]);

    const ops = await collect(loop(fake.runTurn));

    expect(ops).toStrictEqual([addChildren(ROOT_ID, ['s1', 'a'])]);
    expect(fake.calls).toStrictEqual([1]);
    expect(fake.returned).toStrictEqual([]);
  });

  it('ops arriving after complete within the same turn are still yielded, then the loop stops', async () => {
    const fake = script([
      // complete after a→b; a→c hangs under an existing first-level node, so it stays complete.
      { inputs: [call('root', 'a'), call('a', 'b'), call('a', 'c')], end: 'tool-use' },
      { inputs: [call('b', 'd')], end: 'tool-use' },
    ]);

    const ops = await collect(loop(fake.runTurn));

    expect(ops).toStrictEqual([
      addChildren(ROOT_ID, ['s1', 'a']),
      addChildren('s1', ['s2', 'b']),
      addChildren('s1', ['s3', 'c']),
    ]);
    expect(fake.calls).toStrictEqual([1]);
  });
});

describe('turn loop: zero ops', () => {
  it('No tool call is invalid output: a natural end with zero ops rejects ProviderOutputError', async () => {
    const fake = script([{ inputs: [], end: 'natural' }]);

    await expect(collect(loop(fake.runTurn))).rejects.toBeInstanceOf(ProviderOutputError);
    expect(fake.calls).toStrictEqual([1]);
  });

  it('zero ops at the turn limit rejects ProviderOutputError', async () => {
    const empty = { inputs: [], end: 'tool-use' as const };
    const fake = script([empty, empty, empty, empty, empty]);

    await expect(collect(loop(fake.runTurn))).rejects.toBeInstanceOf(ProviderOutputError);
    expect(fake.calls).toStrictEqual([1, 2, 3, 4]);
  });

  it('counts ops, not inputs: calls that all truncate to no op reject ProviderOutputError', async () => {
    // depth 0 admits no child at all, so every valid call assembles to undefined.
    const fake = script([{ inputs: [call('root', 'a'), call('root', 'b')], end: 'natural' }]);

    const attempt = loop(fake.runTurn, { caps: { depth: 0, perParent: 7, total: 60 } });

    await expect(collect(attempt)).rejects.toBeInstanceOf(ProviderOutputError);
  });

  it('skips a truncated call and yields the next op', async () => {
    const fake = script([
      { inputs: [call('root', 'a'), call('a', 'b'), call('root', 'c')], end: 'natural' },
    ]);

    const ops = await collect(loop(fake.runTurn, { caps: { depth: 1, perParent: 7, total: 60 } }));

    expect(ops).toStrictEqual([
      addChildren(ROOT_ID, ['s1', 'a']),
      addChildren(ROOT_ID, ['s2', 'c']),
    ]);
  });
});

describe('turn loop: ordering', () => {
  it('yields op 1 before a blocked turn is released', async () => {
    const gate = deferred();
    let released = false;
    const fake = script([
      {
        inputs: [call('root', 'a'), call('a', 'b')],
        end: 'natural',
        hook: {
          at: 1,
          run: async () => {
            await gate.promise;
            released = true;
          },
        },
      },
    ]);
    const attempt = loop(fake.runTurn);

    const first = await attempt.next();

    expect(first).toStrictEqual({ done: false, value: addChildren(ROOT_ID, ['s1', 'a']) });
    expect(released).toBe(false);
    gate.release();
    const rest = await collect({ [Symbol.asyncIterator]: () => attempt });
    expect(rest).toStrictEqual([addChildren('s1', ['s2', 'b'])]);
  });
});

describe('turn loop: abort', () => {
  it('abort before turn 2: runTurn(2) is never called and the loop rejects with signal.reason', async () => {
    const controller = new AbortController();
    const reason = new Error('client abort');
    const fake = script([
      {
        inputs: [call('root', 'a', 'b')],
        end: 'tool-use',
        hook: {
          at: 1,
          run: () => {
            controller.abort(reason);
          },
        },
      },
      { inputs: [call('a', 'c')], end: 'tool-use' },
    ]);
    const received: TreeOp[] = [];

    const drained = (async () => {
      for await (const op of loop(fake.runTurn, { signal: controller.signal })) received.push(op);
    })();

    await expect(drained).rejects.toBe(reason);
    expect(received).toStrictEqual([addChildren(ROOT_ID, ['s1', 'a'], ['s2', 'b'])]);
    expect(fake.calls).toStrictEqual([1]);
  });

  it('an abort before turn 1 rejects with signal.reason without calling runTurn', async () => {
    const controller = new AbortController();
    const reason = new Error('client abort');
    controller.abort(reason);
    const fake = script([{ inputs: [call('root', 'a')], end: 'natural' }]);

    await expect(collect(loop(fake.runTurn, { signal: controller.signal }))).rejects.toBe(reason);
    expect(fake.calls).toStrictEqual([]);
  });

  it('a zero-op abort is not ProviderOutputError', async () => {
    const controller = new AbortController();
    const reason = new Error('client abort');
    const fake = script([
      {
        inputs: [],
        end: 'tool-use',
        hook: {
          at: 0,
          run: () => {
            controller.abort(reason);
          },
        },
      },
      { inputs: [call('root', 'a')], end: 'natural' },
    ]);

    const attempt = collect(loop(fake.runTurn, { signal: controller.signal }));

    await expect(attempt).rejects.toBe(reason);
    await expect(attempt).rejects.not.toBeInstanceOf(ProviderOutputError);
    expect(fake.calls).toStrictEqual([1]);
  });

  it('an abort during a final zero-op turn rejects with signal.reason, not ProviderOutputError', async () => {
    const controller = new AbortController();
    const reason = new Error('client abort');
    const fake = script([
      {
        inputs: [],
        end: 'natural',
        hook: {
          at: 0,
          run: () => {
            controller.abort(reason);
          },
        },
      },
    ]);

    await expect(collect(loop(fake.runTurn, { signal: controller.signal }))).rejects.toBe(reason);
    expect(fake.calls).toStrictEqual([1]);
  });
  it('a next() rejection after abort rejects with signal.reason, not the transport error', async () => {
    const controller = new AbortController();
    const reason = new Error('client abort');
    const runTurn: RunTurn = () => ({
      next: () => {
        controller.abort(reason);
        return Promise.reject(new ProviderTransportError('x'));
      },
    });

    await expect(collect(loop(runTurn, { signal: controller.signal }))).rejects.toBe(reason);
  });

  it('an abort while the consumer holds an op closes the turn before the next item is pulled', async () => {
    const controller = new AbortController();
    const reason = new Error('client abort');
    let pulled = false;
    const fake = script([
      {
        inputs: [call('root', 'a'), call('a', 'b')],
        end: 'natural',
        hook: {
          at: 1,
          run: () => {
            pulled = true;
          },
        },
      },
    ]);
    const received: TreeOp[] = [];

    const drained = (async () => {
      for await (const op of loop(fake.runTurn, { signal: controller.signal })) {
        received.push(op);
        controller.abort(reason);
      }
    })();

    await expect(drained).rejects.toBe(reason);
    expect(received).toStrictEqual([addChildren(ROOT_ID, ['s1', 'a'])]);
    expect(pulled).toBe(false);
    expect(fake.returned).toStrictEqual([1]);
  });

  it('an abort mid-turn stops a signal-unaware turn at its next handed-over item', async () => {
    const controller = new AbortController();
    const reason = new Error('client abort');
    const fake = script([
      {
        inputs: [call('root', 'a'), call('a', 'b')],
        end: 'natural',
        hook: {
          at: 1,
          run: () => {
            controller.abort(reason);
          },
        },
      },
    ]);
    const received: TreeOp[] = [];

    const drained = (async () => {
      for await (const op of loop(fake.runTurn, { signal: controller.signal })) received.push(op);
    })();

    await expect(drained).rejects.toBe(reason);
    expect(received).toStrictEqual([addChildren(ROOT_ID, ['s1', 'a'])]);
    expect(fake.returned).toStrictEqual([1]);
  });

  it('an abort during the last turn after ops rejects with signal.reason on a natural end', async () => {
    const controller = new AbortController();
    const reason = new Error('client abort');
    const fake = script([
      {
        inputs: [call('root', 'a')],
        end: 'natural',
        hook: {
          at: 1,
          run: () => {
            controller.abort(reason);
          },
        },
      },
    ]);

    await expect(collect(loop(fake.runTurn, { signal: controller.signal }))).rejects.toBe(reason);
    expect(fake.calls).toStrictEqual([1]);
    expect(fake.returned).toStrictEqual([]);
  });

  it('an assembler error raised while aborted rejects with signal.reason', async () => {
    const controller = new AbortController();
    const reason = new Error('client abort');
    // Reading parentId aborts mid-assemble, then the unknown parent fails validation.
    const input = {
      get parentId() {
        controller.abort(reason);
        return 'never-introduced';
      },
      children: [{ id: 'x', text: 'text x' }],
    };
    const fake = script([{ inputs: [call('root', 'a'), input], end: 'natural' }]);

    await expect(collect(loop(fake.runTurn, { signal: controller.signal }))).rejects.toBe(reason);
    expect(fake.returned).toStrictEqual([1]);
  });
});

describe('turn loop: closing the turn', () => {
  it('closes the turn when the assembler rejects an input mid-turn', async () => {
    const fake = script([
      { inputs: [call('root', 'a'), { parentId: 'root' }, call('a', 'b')], end: 'natural' },
    ]);
    const received: TreeOp[] = [];

    const drained = (async () => {
      for await (const op of loop(fake.runTurn)) received.push(op);
    })();

    await expect(drained).rejects.toBeInstanceOf(ProviderOutputError);
    expect(received).toStrictEqual([addChildren(ROOT_ID, ['s1', 'a'])]);
    expect(fake.returned).toStrictEqual([1]);
  });

  it('closes the turn when the consumer stops iterating', async () => {
    const fake = script([
      { inputs: [call('root', 'a', 'b'), call('a', 'c')], end: 'tool-use' },
      { inputs: [call('b', 'd')], end: 'tool-use' },
    ]);
    const received: TreeOp[] = [];

    for await (const op of loop(fake.runTurn)) {
      received.push(op);
      break;
    }

    expect(received).toStrictEqual([addChildren(ROOT_ID, ['s1', 'a'], ['s2', 'b'])]);
    expect(fake.returned).toStrictEqual([1]);
    expect(fake.calls).toStrictEqual([1]);
  });

  it('does not close a turn whose next() rejected; the turn error propagates', async () => {
    const fake = script([
      {
        inputs: [call('root', 'a')],
        end: 'natural',
        hook: {
          at: 1,
          run: () => {
            throw new ProviderTransportError('turn failed');
          },
        },
      },
    ]);

    await expect(collect(loop(fake.runTurn))).rejects.toBeInstanceOf(ProviderTransportError);
    expect(fake.returned).toStrictEqual([]);
  });

  it('surfaces the assembler error from a turn iterator without return()', async () => {
    const inputs: unknown[] = [{ parentId: 'root' }];
    const runTurn: RunTurn = () => ({
      next: () => {
        const input = inputs.shift();
        return Promise.resolve(
          input === undefined
            ? { done: true, value: 'natural' }
            : { done: false, value: { type: 'tool-input', input } },
        );
      },
    });

    await expect(collect(loop(runTurn))).rejects.toBeInstanceOf(ProviderOutputError);
  });

  it('a rejecting return() does not replace the assembler error that stopped the turn', async () => {
    const inputs: unknown[] = [{ parentId: 'root' }];
    const runTurn: RunTurn = () => ({
      next: () =>
        Promise.resolve({ done: false, value: { type: 'tool-input', input: inputs.shift() } }),
      return: () => Promise.reject(new Error('cleanup failed')),
    });

    await expect(collect(loop(runTurn))).rejects.toBeInstanceOf(ProviderOutputError);
  });
});
