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
// the turn is suspended on an item being processed: an assembler error or a consumer stop then
// closes it, while a turn that finished or whose next() rejected is left alone (as for await does).
async function* drainTurn(
  turn: AsyncIterator<TurnItem, TurnEnd>,
  assembler: OpAssembler,
): AsyncGenerator<TreeOp, TurnResult, undefined> {
  let ops = 0;
  let open = false;
  try {
    for (;;) {
      open = false;
      const step = await turn.next();
      if (step.done === true) return { end: step.value, ops };
      open = true;
      const op = assembler.assemble(step.value.input);
      if (op !== undefined) {
        ops += 1;
        yield op;
      }
    }
  } finally {
    if (open) await turn.return?.();
  }
}

// The only code that counts model turns and decides to stop (design D3 "One loop"). Every
// adapter supplies just `runTurn`.
export async function* runTurnLoop({
  request,
  idFactory,
  caps,
  runTurn,
  maxTurns = 4,
}: TurnLoopOptions): AsyncGenerator<TreeOp, void, undefined> {
  const assembler = createOpAssembler({ rootId: request.rootId, idFactory, caps });
  let ops = 0;
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    // Rejects with signal.reason; an abort is never turned into ProviderOutputError (D5).
    request.signal.throwIfAborted();
    const result = yield* drainTurn(runTurn(turn), assembler);
    ops += result.ops;
    if (result.end !== 'tool-use' || assembler.complete) break;
  }
  if (ops === 0) {
    // An abort that landed during the last turn still wins over the zero-op verdict.
    request.signal.throwIfAborted();
    throw new ProviderOutputError('attempt ended without emitting any op');
  }
}
