import { setImmediate as drainMacrotask } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { GenerateError } from '../../domain/errors';
import type { TreeOp } from '../../domain/tree-op';
import { HttpGenerateSource } from './http-generate-source';

const INPUT = { topic: '  读书要点 ', rootId: 'r' };
const SENTINEL = 'server-diagnostic-307';
const op1: TreeOp = { op: 'add_children', parentId: 'r', children: [{ id: 'a', text: '要点' }] };
// U+2028 stays raw in JSON.stringify output; it must not end a frame line.
const op2: TreeOp = { op: 'add_children', parentId: 'a', children: [{ id: 'b', text: 'x y' }] };
const encoder = new TextEncoder();
const frame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const DONE = frame('done', {});
const HANG = Symbol('hang');
type Step = string | Uint8Array | Error | typeof HANG;

// highWaterMark 0: the stream pulls only for a pending read, so `pulls` counts reads.
class FakeBody {
  pulls = 0;
  cancelled = false;
  fail: (reason: Error) => void = () => undefined;
  readonly stream: ReadableStream<Uint8Array>;

  constructor(steps: Step[]) {
    const queue = [...steps];
    this.stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          this.fail = (reason) => {
            controller.error(reason);
          };
        },
        pull: (controller) => {
          this.pulls += 1;
          const step = queue.shift();
          if (step === HANG) return new Promise<void>(() => undefined);
          if (step === undefined) controller.close();
          else if (step instanceof Error) controller.error(step);
          else controller.enqueue(typeof step === 'string' ? encoder.encode(step) : step);
          return undefined;
        },
        cancel: () => {
          this.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
  }
}

async function run(source: HttpGenerateSource, signal: AbortSignal, onOp?: () => void) {
  const ops: TreeOp[] = [];
  try {
    for await (const op of source.generate(INPUT, signal)) {
      ops.push(op);
      onOp?.();
    }
    return { ops, error: undefined };
  } catch (error) {
    return { ops, error };
  }
}

const sourceOf = (body: FakeBody): HttpGenerateSource =>
  new HttpGenerateSource(() => Promise.resolve(new Response(body.stream)));

async function drain(steps: Step[], stopAfterFirstOp = false) {
  const body = new FakeBody(steps);
  const controller = new AbortController();
  const stop = (): void => {
    controller.abort();
  };
  return {
    ...(await run(sourceOf(body), controller.signal, stopAfterFirstOp ? stop : undefined)),
    body,
  };
}

const codeOf = (error: unknown): unknown => (error instanceof GenerateError ? error.code : error);

describe('HTTP generate source request', () => {
  it.each<[string | undefined]>([['binding-307'], [undefined]])(
    'POSTs the input unchanged with binding %s',
    async (binding) => {
      const fetchGenerate = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(new FakeBody([DONE]).stream)),
      );
      const { signal } = new AbortController();
      await run(new HttpGenerateSource(fetchGenerate, binding), signal);
      expect(fetchGenerate).toHaveBeenCalledOnce();
      const [url, init] = fetchGenerate.mock.calls[0] ?? [];
      expect(url).toBe('/api/ai/generate');
      expect(init?.method).toBe('POST');
      const body = init?.body;
      if (typeof body !== 'string') throw new Error('expected a serialized body');
      expect(JSON.parse(body)).toStrictEqual({ topic: '  读书要点 ', rootId: 'r' });
      const headers = new Headers(init?.headers);
      expect(headers.get('content-type')).toBe('application/json');
      expect(headers.get('x-mindsprout-session-binding')).toBe(binding ?? null);
      expect(init?.signal).toBe(signal);
    },
  );
});

describe('HTTP generate source frames', () => {
  it('reassembles a body split at every byte offset, inside 要点 included', async () => {
    const bytes = encoder.encode(frame('op', op1) + frame('op', op2) + DONE);
    for (let offset = 0; offset <= bytes.length; offset += 1) {
      const steps = [bytes.slice(0, offset), bytes.slice(offset)];
      const { ops, error } = await drain(steps);
      expect({ ops, error }).toStrictEqual({ ops: [op1, op2], error: undefined });
    }
  });

  it('yields every op of several frames in one chunk, then ends', async () => {
    const chunk = frame('op', op1) + frame('op', op2) + DONE;
    const { ops, error } = await drain([chunk]);
    expect({ ops, error }).toStrictEqual({ ops: [op1, op2], error: undefined });
  });

  it.each(['timeout', 'provider-error', 'invalid-output', 'refused'])(
    'yields the op before an error frame, then throws %s without the server message',
    async (code) => {
      const { ops, error } = await drain([
        frame('op', op1),
        frame('error', { code, message: SENTINEL }),
      ]);
      expect(ops).toStrictEqual([op1]);
      expect(codeOf(error)).toBe(code);
      expect(String(error)).not.toContain(SENTINEL);
    },
  );

  it.each([
    [
      'an error frame with an unknown code',
      [frame('error', { code: 'internal' })],
      'provider-error',
    ],
    ['an error frame without a code', [frame('error', { message: SENTINEL })], 'provider-error'],
    [
      'an error frame with a non-frame code',
      [frame('error', { code: 'network' })],
      'provider-error',
    ],
    ['an error frame whose data is not JSON', ['event: error\ndata: oops\n\n'], 'provider-error'],
    ['an empty body', [], 'provider-error'],
    ['one op then EOF', [frame('op', op1)], 'provider-error'],
    ['a partial frame then EOF', ['event: done\ndata: {}\n'], 'provider-error'],
    ['an unknown event', [frame('ping', {})], 'provider-error'],
    ['a three-line frame', ['event: done\ndata: {}\nretry: 1\n\n'], 'provider-error'],
    ['done with other data', [frame('done', { x: 1 })], 'provider-error'],
    ['op data that is not JSON', ['event: op\ndata: {nope\n\n'], 'invalid-output'],
    ['an op failing parseTreeOp', [frame('op', { ...op1, children: [] })], 'invalid-output'],
  ])('ends %s with %s', async (_case, steps, code) => {
    const { ops, error } = await drain(steps);
    expect(ops).toStrictEqual(steps[0] === frame('op', op1) ? [op1] : []);
    expect(codeOf(error)).toBe(code);
  });

  it('never reads the bytes after the done frame', async () => {
    const chunk = frame('op', op1) + DONE + frame('op', op2);
    const { ops, error, body } = await drain([chunk, frame('op', op2)]);
    expect({ ops, error }).toStrictEqual({ ops: [op1], error: undefined });
    expect(body).toMatchObject({ pulls: 1, cancelled: true });
  });
});

describe('HTTP generate source status', () => {
  it.each([
    [401, '{"error":"unauthenticated"}', 'unauthenticated'],
    [503, '{"error":"ai-unavailable"}', 'ai-unavailable'],
    [400, frame('error', { code: 'timeout', message: SENTINEL }), 'provider-error'],
    [415, '{"error":"unsupported-media-type"}', 'provider-error'],
    [500, '{"error":"unauthenticated"}', 'provider-error'],
  ])('maps HTTP %i to %s without reading its body', async (status, text, code) => {
    const fetchGenerate = vi.fn<typeof fetch>();
    const body = new FakeBody([text]);
    const response = new Response(body.stream, { status });
    fetchGenerate.mockResolvedValue(response);
    const { ops, error } = await run(
      new HttpGenerateSource(fetchGenerate),
      new AbortController().signal,
    );
    expect({ ops, code: codeOf(error) }).toStrictEqual({ ops: [], code });
    expect(response.bodyUsed).toBe(false);
    expect(body.pulls).toBe(0);
  });

  it('maps a 200 without a body to provider-error', async () => {
    const source = new HttpGenerateSource(() => Promise.resolve(new Response(null)));
    expect(codeOf((await run(source, new AbortController().signal)).error)).toBe('provider-error');
  });

  it('maps a fetch rejection to network', async () => {
    const source = new HttpGenerateSource(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(codeOf((await run(source, new AbortController().signal)).error)).toBe('network');
  });
});

async function withoutUnhandledRejection(action: () => Promise<void>): Promise<void> {
  const unhandled: unknown[] = [];
  const record = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', record);
  try {
    await action();
    await drainMacrotask();
  } finally {
    process.off('unhandledRejection', record);
  }
  expect(unhandled).toStrictEqual([]);
}

describe('HTTP generate source connection loss', () => {
  it('maps a read rejection mid-stream to network', async () => {
    await withoutUnhandledRejection(async () => {
      const { ops, error } = await drain([frame('op', op1), new Error('stream-broke-307')]);
      expect(ops).toStrictEqual([op1]);
      expect(error).toBeInstanceOf(GenerateError);
      expect(codeOf(error)).toBe('network');
    });
  });

  it('ends normally when Stop follows a connection drop while an op is held', async () => {
    await withoutUnhandledRejection(async () => {
      const body = new FakeBody([frame('op', op1), DONE]);
      const controller = new AbortController();
      const source = sourceOf(body);
      const iterator = source.generate(INPUT, controller.signal)[Symbol.asyncIterator]();
      expect(await iterator.next()).toStrictEqual({ done: false, value: op1 });
      body.fail(new Error('stream-broke-307'));
      controller.abort();
      expect(await iterator.next()).toStrictEqual({ done: true, value: undefined });
    });
  });
});

describe('HTTP generate source abort', () => {
  it('does not fetch for an already-aborted signal', async () => {
    const fetchGenerate = vi.fn<typeof fetch>();
    expect(await run(new HttpGenerateSource(fetchGenerate), AbortSignal.abort())).toStrictEqual({
      ops: [],
      error: undefined,
    });
    expect(fetchGenerate).not.toHaveBeenCalled();
  });

  it('settles a pending read on abort even when fetch ignores the signal', async () => {
    const body = new FakeBody([frame('op', op1), HANG]);
    const controller = new AbortController();
    const source = sourceOf(body);
    const iterator = source.generate(INPUT, controller.signal)[Symbol.asyncIterator]();
    expect(await iterator.next()).toStrictEqual({ done: false, value: op1 });
    const pending = iterator.next();
    await drainMacrotask();
    expect(body.pulls).toBe(2);
    controller.abort();
    const settled = await Promise.race([pending, drainMacrotask().then(() => 'pending')]);
    expect(settled).toStrictEqual({ done: true, value: undefined });
    expect(body.cancelled).toBe(true);
  });

  it('stops at the abort among frames already buffered in one chunk', async () => {
    const chunk = frame('op', op1) + frame('op', op2) + frame('error', { code: 'timeout' });
    const { ops, error } = await drain([chunk], true);
    expect({ ops, error }).toStrictEqual({ ops: [op1], error: undefined });
  });

  it.each([
    ['a 503', () => new Response('{"error":"ai-unavailable"}', { status: 503 })],
    ['a 200 SSE body', () => new Response(new FakeBody([frame('op', op1), DONE]).stream)],
  ])('ends with no value when Stop lands during a fetch that resolves %s', async (_, respond) => {
    let resolve: (response: Response) => void = () => undefined;
    const fetchGenerate = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((release) => {
          resolve = release;
        }),
    );
    const controller = new AbortController();
    const running = run(new HttpGenerateSource(fetchGenerate), controller.signal);
    expect(fetchGenerate).toHaveBeenCalledOnce();
    controller.abort();
    resolve(respond());
    expect(await running).toStrictEqual({ ops: [], error: undefined });
  });

  it('ends normally when fetch rejects with AbortError after Stop', async () => {
    const controller = new AbortController();
    const source = new HttpGenerateSource(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const running = run(source, controller.signal);
    controller.abort();
    expect(await running).toStrictEqual({ ops: [], error: undefined });
  });

  it('cancels the body when the consumer breaks out after one op', async () => {
    const body = new FakeBody([frame('op', op1), frame('op', op2), DONE]);
    const source = sourceOf(body);
    for await (const op of source.generate(INPUT, new AbortController().signal)) {
      expect(op).toStrictEqual(op1);
      break;
    }
    expect(body.cancelled).toBe(true);
  });
});
