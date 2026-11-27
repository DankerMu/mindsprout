import { getEventListeners } from 'node:events';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createLogger } from '@/shared/logger';
import type { TreeOp } from '../acl/map';
import {
  type ProviderErrorCode,
  ProviderOutputError,
  ProviderRefusedError,
  ProviderTransportError,
} from '../domain/errors';
import { PRODUCTION_CAPS } from '../domain/generate-tool';
import { type GenerationLog, GenerationError, generate } from './generate';
import type { GenerateRequest, Provider } from './provider';
import { runTurnLoop } from './turn-loop';

// Seam under test: generate(provider, request, options) and GenerationError (issue #299 fixture).
// Fakes are async-generator providers that honour their signal; timers are Vitest fakes.

const TOPIC = 'My private topic about Project Nightingale';
const ROOT_ID = 'primary-root';
const PROVIDER_ID = 'anthropic';
const MODEL = 'claude-test-model';

// The fixed messages, copied from the fixture (not from generate.ts).
const MESSAGES: Record<ProviderErrorCode, string> = {
  timeout: 'The generation exceeded its time limit',
  'provider-error': 'The AI provider request failed',
  'invalid-output': 'The AI provider returned unusable output',
  refused: 'The AI provider refused the topic',
};

function op(id: string): TreeOp {
  return { op: 'add_children', parentId: ROOT_ID, children: [{ id, text: `text ${id}` }] };
}

type Attempt = (request: GenerateRequest) => AsyncIterable<TreeOp>;

// Rejects with the signal's reason once it aborts.
function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

// One fake attempt: yields its ops, then awaits `end`; a rejection of `end` fails the attempt.
function attempt(
  ops: TreeOp[],
  end: (signal: AbortSignal) => Promise<void> = () => Promise.resolve(),
): Attempt {
  return async function* ({ signal }) {
    yield* ops;
    await end(signal);
  };
}

const emits = (...ops: TreeOp[]): Attempt => attempt(ops);

const failsAfter = (error: Error, ...ops: TreeOp[]): Attempt =>
  attempt(ops, () => Promise.reject(error));

// Waits on its signal and rejects with signal.reason (the port precondition).
const waitsForAbort = (...ops: TreeOp[]): Attempt => attempt(ops, untilAborted);

// Waits on its signal, then throws a retryable-looking transport error instead of the reason.
const failsWhenAborted = (...ops: TreeOp[]): Attempt =>
  attempt(ops, async (signal) => {
    await untilAborted(signal).catch(() => undefined);
    throw new ProviderTransportError('socket closed after abort');
  });

// Fails with `error` after `ms` on the (fake) clock, without looking at its signal.
const delayedFailure = (ms: number, error: Error): Attempt =>
  attempt([], async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    throw error;
  });

// The real turn loop over a model turn that ends naturally without calling the tool.
const noToolCall: Attempt = (request) =>
  runTurnLoop({
    request,
    idFactory: () => 'unused-id',
    caps: PRODUCTION_CAPS,
    runTurn: () => ({ next: () => Promise.resolve({ done: true, value: 'natural' }) }),
  });

// Records the request of every streamOps call; an unscripted attempt is a test failure.
function fakeProvider(...attempts: Attempt[]) {
  const requests: GenerateRequest[] = [];
  const provider: Provider = {
    streamOps(request) {
      requests.push(request);
      const attempt = attempts[requests.length - 1];
      if (attempt === undefined) throw new Error('unscripted attempt');
      return attempt(request);
    },
  };
  return { provider, requests, signals: () => requests.map((request) => request.signal) };
}

async function drain(ops: AsyncIterable<TreeOp>): Promise<{ ops: TreeOp[]; error: unknown }> {
  const out: TreeOp[] = [];
  try {
    for await (const item of ops) out.push(item);
    return { ops: out, error: undefined };
  } catch (error) {
    return { ops: out, error };
  }
}

let log: { info: ReturnType<typeof vi.fn<(fields: object) => void>> };
let callerSignals: AbortSignal[];

function request(signal: AbortSignal = new AbortController().signal): GenerateRequest {
  callerSignals.push(signal);
  return { topic: TOPIC, rootId: ROOT_ID, signal };
}

function options(timeoutMs?: number) {
  return {
    providerId: PROVIDER_ID,
    model: MODEL,
    log,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

type Outcome = 'done' | 'aborted' | ProviderErrorCode;

// The single ai.generate entry: exactly seven fields.
function expectLogged(attempts: number, ops: number, outcome: Outcome, durationMs = 0): void {
  expect(log.info).toHaveBeenCalledTimes(1);
  expect(log.info.mock.calls[0]?.[0]).toStrictEqual({
    event: 'ai.generate',
    provider: PROVIDER_ID,
    model: MODEL,
    attempts,
    ops,
    durationMs,
    outcome,
  });
}

function expectGenerationError(error: unknown, code: ProviderErrorCode): void {
  expect(error).toBeInstanceOf(GenerationError);
  expect(error).toMatchObject({ name: 'GenerationError', code, message: MESSAGES[code] });
  expect((error as Error).cause).toBeUndefined();
}

describe('generate', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    log = { info: vi.fn<(fields: object) => void>() };
    callerSignals = [];
  });

  afterEach(() => {
    // Every exit releases the timer and the caller listener and logs exactly once.
    expect(vi.getTimerCount()).toBe(0);
    for (const signal of callerSignals) expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    expect(log.info).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('emits every op of a successful first attempt and logs done', async () => {
    const fake = fakeProvider(emits(op('a'), op('b')));
    const result = await drain(generate(fake.provider, request(), options()));
    expect(result).toEqual({ ops: [op('a'), op('b')], error: undefined });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ topic: TOPIC, rootId: ROOT_ID });
    expectLogged(1, 2, 'done');
  });

  it('retry succeeds: emits the second attempt ops through the same linked signal', async () => {
    const fake = fakeProvider(
      failsAfter(new ProviderTransportError('503')),
      emits(op('a'), op('b')),
    );
    const caller = request();
    const result = await drain(generate(fake.provider, caller, options()));
    expect(result).toEqual({ ops: [op('a'), op('b')], error: undefined });
    const [first, second] = fake.signals();
    expect(first).toBe(second);
    expect(first).not.toBe(caller.signal);
    expectLogged(2, 2, 'done');
  });

  it.each([
    ['ProviderOutputError', ProviderOutputError, 'invalid-output'],
    ['ProviderTransportError', ProviderTransportError, 'provider-error'],
  ] as const)(
    'retry exhausted: two %ss before any op end after exactly two calls',
    async (_, ErrorClass, code) => {
      const fake = fakeProvider(
        failsAfter(new ErrorClass('one')),
        failsAfter(new ErrorClass('two')),
      );
      const result = await drain(generate(fake.provider, request(), options()));
      expect(result.ops).toEqual([]);
      expectGenerationError(result.error, code);
      expect(fake.requests).toHaveLength(2);
      expectLogged(2, 0, code);
    },
  );

  it.each([
    ['transport failure after two ops', new ProviderTransportError('reset'), 2, 'provider-error'],
    ['invalid output after one op', new ProviderOutputError('bad parent'), 1, 'invalid-output'],
  ] as const)(
    'failure after first op: %s keeps the ops, no retry',
    async (_, error, count, code) => {
      const ops = [op('a'), op('b')].slice(0, count);
      const fake = fakeProvider(failsAfter(error, ...ops), emits(op('retried')));
      const result = await drain(generate(fake.provider, request(), options()));
      expect(result.ops).toEqual(ops);
      expectGenerationError(result.error, code);
      expect(fake.requests).toHaveLength(1);
      expectLogged(1, count, code);
    },
  );

  it('refusal before any op ends refused after one call', async () => {
    const fake = fakeProvider(failsAfter(new ProviderRefusedError('declined')), emits(op('a')));
    const result = await drain(generate(fake.provider, request(), options()));
    expect(result.ops).toEqual([]);
    expectGenerationError(result.error, 'refused');
    expect(fake.requests).toHaveLength(1);
    expectLogged(1, 0, 'refused');
  });

  it('no tool call is invalid output: the turn loop zero-op error is retried once', async () => {
    const fake = fakeProvider(noToolCall, emits(op('a')));
    const result = await drain(generate(fake.provider, request(), options()));
    expect(result).toEqual({ ops: [op('a')], error: undefined });
    expect(fake.requests).toHaveLength(2);
    expectLogged(2, 1, 'done');
  });

  it('an unknown error is provider-error with no retry', async () => {
    const fake = fakeProvider(failsAfter(new TypeError('boom')), emits(op('a')));
    const result = await drain(generate(fake.provider, request(), options()));
    expectGenerationError(result.error, 'provider-error');
    expect(fake.requests).toHaveLength(1);
    expectLogged(1, 0, 'provider-error');
  });

  it('slow provider: the default 30 s limit aborts the provider and ends timeout', async () => {
    const fake = fakeProvider(waitsForAbort(), emits(op('retried')));
    const settled = drain(generate(fake.provider, request(), options()));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fake.signals()[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.signals()[0]?.aborted).toBe(true);
    const result = await settled;
    expectGenerationError(result.error, 'timeout');
    expect(fake.requests).toHaveLength(1);
    expectLogged(1, 0, 'timeout', 30_000);
  });

  it('the time limit spans both attempts', async () => {
    const fake = fakeProvider(
      delayedFailure(20_000, new ProviderTransportError('502')),
      waitsForAbort(),
    );
    const settled = drain(generate(fake.provider, request(), options()));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fake.signals()[1]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.signals()[1]?.aborted).toBe(true);
    const result = await settled;
    expectGenerationError(result.error, 'timeout');
    expectLogged(2, 0, 'timeout', 30_000);
  });

  it('a timeout is never retried, even when the provider throws a retryable error', async () => {
    const fake = fakeProvider(failsWhenAborted(), emits(op('retried')));
    const settled = drain(generate(fake.provider, request(), options()));
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await settled;
    expectGenerationError(result.error, 'timeout');
    expect(fake.requests).toHaveLength(1);
    expectLogged(1, 0, 'timeout', 30_000);
  });

  it('honours a custom timeoutMs', async () => {
    const fake = fakeProvider(waitsForAbort(op('a')));
    const settled = drain(generate(fake.provider, request(), options(5_000)));
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await settled;
    expect(result.ops).toEqual([op('a')]);
    expectGenerationError(result.error, 'timeout');
    expectLogged(1, 1, 'timeout', 5_000);
  });

  it('an already aborted request returns silently without calling the provider', async () => {
    const fake = fakeProvider(emits(op('a')));
    const result = await drain(generate(fake.provider, request(AbortSignal.abort()), options()));
    expect(result).toEqual({ ops: [], error: undefined });
    expect(fake.requests).toHaveLength(0);
    expectLogged(0, 0, 'aborted');
  });

  it('a client abort before any op ends silently without retry', async () => {
    const controller = new AbortController();
    const fake = fakeProvider(failsWhenAborted(), emits(op('retried')));
    const generation = generate(fake.provider, request(controller.signal), options());
    const next = generation.next();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.requests).toHaveLength(1);
    controller.abort();
    await expect(next).resolves.toEqual({ done: true, value: undefined });
    expect(fake.signals()[0]?.aborted).toBe(true);
    expect(fake.requests).toHaveLength(1);
    expectLogged(1, 0, 'aborted');
  });

  it('a client abort after one op ends silently and keeps the op', async () => {
    const controller = new AbortController();
    const fake = fakeProvider(failsWhenAborted(op('a')), emits(op('retried')));
    const generation = generate(fake.provider, request(controller.signal), options());
    await expect(generation.next()).resolves.toEqual({ done: false, value: op('a') });
    const next = generation.next();
    controller.abort();
    await expect(next).resolves.toEqual({ done: true, value: undefined });
    expect(fake.requests).toHaveLength(1);
    expectLogged(1, 1, 'aborted');
  });

  it('an early return() by the consumer aborts the provider signal', async () => {
    const fake = fakeProvider(waitsForAbort(op('a'), op('b')));
    const generation = generate(fake.provider, request(), options());
    await expect(generation.next()).resolves.toEqual({ done: false, value: op('a') });
    expect(fake.signals()[0]?.aborted).toBe(false);
    await expect(generation.return()).resolves.toEqual({ done: true, value: undefined });
    expect(fake.signals()[0]?.aborted).toBe(true);
    expectLogged(1, 1, 'aborted');
  });

  it('provider HTTP error body withheld: no key, body or topic in the error or the log', async () => {
    const key = 'fixture-credential-299';
    const body = '{"error":{"message":"overloaded","request_id":"req_0123456789"}}';
    const leaky = () => new ProviderTransportError(`HTTP 529 key=${key} body=${body} ${TOPIC}`);
    const fake = fakeProvider(failsAfter(leaky()), failsAfter(leaky()));
    const result = await drain(generate(fake.provider, request(), options()));
    expectGenerationError(result.error, 'provider-error');
    const surfaced = inspect(result.error, { depth: null }) + JSON.stringify(log.info.mock.calls);
    for (const secret of [key, body, 'req_0123456789', TOPIC]) {
      expect(surfaced).not.toContain(secret);
    }
    expectLogged(2, 0, 'provider-error');
  });
});

describe('GenerationLog', () => {
  it('accepts the shared pino logger', async () => {
    const shared = createLogger('silent');
    expectTypeOf(shared).toExtend<GenerationLog>();
    const fake = fakeProvider(emits(op('a')));
    const caller = { topic: TOPIC, rootId: ROOT_ID, signal: new AbortController().signal };
    const result = await drain(
      generate(fake.provider, caller, { providerId: PROVIDER_ID, model: MODEL, log: shared }),
    );
    expect(result).toEqual({ ops: [op('a')], error: undefined });
  });
});
