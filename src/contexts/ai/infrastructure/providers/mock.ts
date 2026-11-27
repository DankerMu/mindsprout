import type { NodeId } from '../../acl/map';
import type { GenerateRequest, Provider } from '../../application/provider';
import { runTurnLoop, type TurnEnd, type TurnItem } from '../../application/turn-loop';
import { ProviderRefusedError, ProviderTransportError } from '../../domain/errors';
import { PRODUCTION_CAPS } from '../../domain/generate-tool';

// The deterministic mock adapter (design D11). Every scenario, reserved or injected, is a turn
// script played by the same `runTurn` through `runTurnLoop` with PRODUCTION_CAPS, so its output
// passes the same assembler validation, id replacement and stopping as a real provider.

// One step of a scripted model turn: a completed (parsed) add_children input; a wait that starts
// with `onWait` and settles only when the request's signal aborts; or a failure of the turn.
type MockStep = TurnItem | { type: 'wait'; onWait: () => void } | { type: 'error'; error: Error };

interface MockTurn {
  steps: readonly MockStep[];
  end: TurnEnd;
}

// Turn n (1-based) of an attempt. Called once per turn the loop requests.
export type MockScript = (turn: number) => MockTurn;

interface MockProviderOptions {
  idFactory: () => NodeId;
  // Awaited before each tool input; composition sets the pacing (task 4.1).
  delayMs: number;
  // Test seam: replaces the topic-selected script. Composition never passes it.
  script?: MockScript;
}

const FIRST_LEVEL = ['p1', 'p2', 'p3', 'p4'];
const SECOND_LEVEL = ['1', '2', '3'];

function call(parentId: string, ids: readonly string[], text: (id: string) => string): MockStep {
  return {
    type: 'tool-input',
    input: { parentId, children: ids.map((id) => ({ id, text: text(id) })) },
  };
}

const ROOT_CALL = call('root', FIRST_LEVEL, (id) => `要点 ${id.slice(1)}`);

function firstLevelCall(parent: string): MockStep {
  return call(
    parent,
    SECOND_LEVEL.map((id) => `${parent}-${id}`),
    (id) => `要点 ${id.slice(1).replace('-', '.')}`,
  );
}

// Past its last turn a script's model answers naturally without calling the tool.
const NATURAL_END: MockTurn = { steps: [], end: 'natural' };

function scriptOf(turns: readonly MockTurn[]): MockScript {
  return (turn) => turns[turn - 1] ?? NATURAL_END;
}

// Turn 2 completes the skeleton and still ends on tool use, so the loop's `complete` stop (not
// the script) ends the attempt after 5 ops and 16 nodes.
const SKELETON = scriptOf([
  { steps: [ROOT_CALL], end: 'tool-use' },
  { steps: FIRST_LEVEL.map(firstLevelCall), end: 'tool-use' },
]);

// Error objects are built per attempt; messages are fixed and never carry the topic.
const RESERVED = new Map<string, () => MockScript>([
  [
    'mock:error-after-2',
    () =>
      scriptOf([
        { steps: [ROOT_CALL], end: 'tool-use' },
        {
          steps: [
            firstLevelCall('p1'),
            { type: 'error', error: new ProviderTransportError('mock transport failed') },
          ],
          end: 'tool-use',
        },
      ]),
  ],
  [
    'mock:invalid-first',
    () =>
      scriptOf([
        {
          steps: [{ type: 'tool-input', input: { parentId: 'root', children: [] } }],
          end: 'natural',
        },
      ]),
  ],
  [
    'mock:refused',
    () =>
      scriptOf([
        {
          steps: [{ type: 'error', error: new ProviderRefusedError('mock refused') }],
          end: 'natural',
        },
      ]),
  ],
]);

// The script a topic selects: a reserved scenario (fresh per attempt) or the default skeleton.
export function mockScriptFor(topic: string): MockScript {
  return RESERVED.get(topic)?.() ?? SKELETON;
}

// Waits ms, or less when the signal aborts first; then rejects with signal.reason if it did.
// Leaves no timer or listener behind either way.
async function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
  signal.throwIfAborted();
}

// Settles only when the signal aborts, rejecting with signal.reason. onWait fires after the
// listener is armed, so an abort it triggers is not missed.
async function waitForAbort(signal: AbortSignal, onWait: () => void): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
    onWait();
  });
  signal.throwIfAborted();
}

async function* playTurn(
  turn: MockTurn,
  signal: AbortSignal,
  delayMs: number,
): AsyncGenerator<TurnItem, TurnEnd, undefined> {
  for (const step of turn.steps) {
    if (step.type === 'tool-input') {
      await pause(delayMs, signal);
      yield step;
    } else if (step.type === 'wait') {
      await waitForAbort(signal, step.onWait);
    } else {
      throw step.error;
    }
  }
  return turn.end;
}

export function createMockProvider({ idFactory, delayMs, script }: MockProviderOptions): Provider {
  return {
    streamOps(request: GenerateRequest) {
      const turns = script ?? mockScriptFor(request.topic);
      return runTurnLoop({
        request,
        idFactory,
        caps: PRODUCTION_CAPS,
        runTurn: (turn) => playTurn(turns(turn), request.signal, delayMs),
      });
    },
  };
}
