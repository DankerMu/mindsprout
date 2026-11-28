import type { GenerateInput, GenerateSource } from '../../src/contexts/map/domain/generate-source';
import type { TreeOp } from '../../src/contexts/map/domain/tree-op';

// Test-driven GenerateSource for the editor store generate tests ("Issue #308 Fixture Triage").
// Each generate() call starts one FakeRun whose async generator yields only what the test queues,
// with an explicit handshake and no reliance on a count of microtask flushes:
// - push(op) settles on the consumer's next pull (the op was dispatched) or when the generator's
//   finally runs because the consumer called return() (the op was rejected or dropped);
// - finish() and fail(error) end the generator; the test then awaits the promise generate() returned.
// The fake ignores its signal: a real source returns normally once the signal aborts (port
// contract), and a test models that return with finish() after Stop or load.

type Item =
  | { kind: 'op'; op: TreeOp; settle: () => void }
  | { kind: 'finish' }
  | { kind: 'fail'; error: unknown };

export class FakeRun {
  readonly input: GenerateInput;
  readonly signal: AbortSignal;
  // signal.aborted when the consumer's return() ran the finally; null until a return() happens.
  abortedAtReturn: boolean | null = null;
  readonly #queue: Item[] = [];
  #wake: (() => void) | undefined;

  constructor(input: GenerateInput, signal: AbortSignal) {
    this.input = input;
    this.signal = signal;
  }

  push(op: TreeOp): Promise<void> {
    return new Promise((settle) => {
      this.#enqueue({ kind: 'op', op, settle });
    });
  }

  finish(): void {
    this.#enqueue({ kind: 'finish' });
  }

  fail(error: unknown): void {
    this.#enqueue({ kind: 'fail', error });
  }

  async *ops(): AsyncGenerator<TreeOp> {
    let suspended: (() => void) | undefined;
    try {
      for (;;) {
        const item = await this.#take();
        if (item.kind === 'finish') return;
        if (item.kind === 'fail') throw item.error;
        suspended = item.settle;
        yield item.op;
        suspended = undefined;
        item.settle();
      }
    } finally {
      // Suspended at a yield means the consumer called return() instead of pulling again.
      if (suspended !== undefined) {
        this.abortedAtReturn = this.signal.aborted;
        suspended();
      }
    }
  }

  #enqueue(item: Item): void {
    this.#queue.push(item);
    this.#wake?.();
  }

  #take(): Promise<Item> {
    const next = this.#queue.shift();
    if (next !== undefined) return Promise.resolve(next);
    return new Promise((resolve) => {
      this.#wake = () => {
        this.#wake = undefined;
        resolve(this.#take());
      };
    });
  }
}

export class FakeGenerateSource implements GenerateSource {
  readonly runs: FakeRun[] = [];

  generate(input: GenerateInput, signal: AbortSignal): AsyncIterable<TreeOp> {
    const run = new FakeRun(input, signal);
    this.runs.push(run);
    return run.ops();
  }

  run(index: number): FakeRun {
    const run = this.runs[index];
    if (run === undefined) throw new Error(`expected generate call #${String(index)}`);
    return run;
  }
}
