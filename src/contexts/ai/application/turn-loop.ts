import type { NodeId, TreeOp } from '../acl/map';
import { ProviderOutputError } from '../domain/errors';
import type { GenerationCaps } from '../domain/generate-tool';
import { createOpAssembler, type OpAssembler } from './op-assembler';
import type { GenerateRequest } from './provider';

// How a model turn ended, after the adapter applied the D3 turn-end mapping.
export type TurnEnd = 'natural' | 'tool-use';

// One completed tool input of a turn, already JSON-parsed by the adapter.
export interface TurnItem {
  type: 'tool-input';
  input: unknown;
}

interface TurnLoopOptions {
  request: GenerateRequest;
  idFactory: () => NodeId;
  caps: GenerationCaps;
  // Sends turn n (1-based) and streams its tool inputs; the adapter owns transport and history.
  runTurn: (turn: number) => AsyncIterator<TurnItem, TurnEnd>;
  maxTurns?: number;
}

interface TurnResult {
  end: TurnEnd;
  ops: number;
}

// Drains one turn, yielding each op as soon as its input is assembled. `open` is true only while
// the turn is suspended on an item being processed: an assembler error, an abort or a consumer
// stop then closes it, while a turn that finished or whose next() rejected is left alone (as for
// await does). The abort check runs on each handed-over item and again when the consumer resumes.
async function* drainTurn(
  turn: AsyncIterator<TurnItem, TurnEnd>,
  assembler: OpAssembler,
  signal: AbortSignal,
): AsyncGenerator<TreeOp, TurnResult, undefined> {
  let ops = 0;
  let open = false;
  try {
    for (;;) {
      open = false;
      const step = await turn.next();
      if (step.done === true) return { end: step.value, ops };
      open = true;
      signal.throwIfAborted();
      const op = assembler.assemble(step.value.input);
      if (op !== undefined) {
        ops += 1;
        yield op;
        signal.throwIfAborted();
      }
    }
  } finally {
    if (open) await closeTurn(turn);
  }
}

async function closeTurn(turn: AsyncIterator<TurnItem, TurnEnd>): Promise<void> {
  try {
    await turn.return?.();
  } catch {
    // Swallows the adapter's cleanup rejection so it never replaces the error or stop in flight.
  }
}

// The only code that counts model turns and decides to stop (design D3 "One loop"). Every
// adapter supplies just `runTurn`. Once the signal is aborted the attempt always rejects with
// signal.reason: never a normal end, never another error (D3, D5).
export async function* runTurnLoop({
  request,
  idFactory,
  caps,
  runTurn,
  maxTurns = 4,
}: TurnLoopOptions): AsyncGenerator<TreeOp, void, undefined> {
  const { signal } = request;
  const assembler = createOpAssembler({ rootId: request.rootId, idFactory, caps });
  let ops = 0;
  try {
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      signal.throwIfAborted();
      const result = yield* drainTurn(runTurn(turn), assembler, signal);
      ops += result.ops;
      if (result.end !== 'tool-use' || assembler.complete) break;
    }
  } catch (error) {
    // An abort-induced transport or assembler error surfaces as signal.reason, never retryable.
    signal.throwIfAborted();
    throw error;
  }
  // An abort that landed during the last turn wins over a normal end and the zero-op verdict.
  signal.throwIfAborted();
  if (ops === 0) throw new ProviderOutputError('attempt ended without emitting any op');
}
