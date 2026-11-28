import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AccountServices from '@/app/server/account-services';
import { parseTreeOp } from '@/contexts/ai/acl/map';
import type * as Generate from '@/contexts/ai/application/generate';
import { createMockProvider, type MockScript } from '@/contexts/ai/infrastructure/providers/mock';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  mapsForUser: vi.fn(),
  aiService: vi.fn(),
  generate: vi.fn(),
  info: vi.fn(),
  errorLog: vi.fn(),
}));
vi.mock('@/app/server/account-services', async (importOriginal) => ({
  ...(await importOriginal<typeof AccountServices>()),
  requireUser: mocks.requireUser,
  mapsForUser: mocks.mapsForUser,
}));
vi.mock('@/app/server/ai-services', () => ({ aiService: mocks.aiService }));
// `generate` stays the real one (restored before each test); one test replaces it.
vi.mock('@/contexts/ai/application/generate', async (importOriginal) => ({
  ...(await importOriginal<typeof Generate>()),
  generate: mocks.generate,
}));
vi.mock('@/shared/logger', () => ({ logger: { error: mocks.errorLog } }));

import { POST } from './route';

const VALID = { topic: 'Learning plan', rootId: 'r1' };

let streamOps: ReturnType<typeof vi.fn>;

// The real mock adapter, paced at 0 ms, with counter ids; `streamOps` is spied, not replaced.
function useProvider(script?: MockScript): void {
  let next = 0;
  const provider = createMockProvider({
    idFactory: () => `n${String((next += 1))}`,
    delayMs: 0,
    ...(script === undefined ? {} : { script }),
  });
  streamOps = vi.fn(provider.streamOps.bind(provider));
  mocks.aiService.mockReturnValue({
    provider: { streamOps },
    providerId: 'mock',
    model: 'mock',
    log: { info: mocks.info },
  });
}

function post(
  body: string,
  init: { contentType?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Request {
  return new Request('http://localhost/api/ai/generate', {
    method: 'POST',
    headers: { 'content-type': init.contentType ?? 'application/json', ...init.headers },
    body,
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });
}

interface Frame {
  event: string;
  data: string;
}

function parseFrames(text: string): Frame[] {
  if (text === '') return [];
  expect(text.endsWith('\n\n')).toBe(true);
  return text
    .slice(0, -2)
    .split('\n\n')
    .map((chunk) => {
      const match = /^event: (op|error|done)\ndata: ([^\n]*)$/.exec(chunk);
      expect(match, chunk).not.toBeNull();
      return { event: match?.[1] ?? '', data: match?.[2] ?? '' };
    });
}

function readerOf(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  if (response.body === null) throw new Error('the response has no body');
  return response.body.getReader();
}

async function readFrames(response: Response): Promise<Frame[]> {
  return parseFrames(await response.text());
}

const ROOT_STEP = {
  type: 'tool-input' as const,
  input: {
    parentId: 'root',
    children: [
      { id: 'p1', text: 'one' },
      { id: 'p2', text: 'two' },
      { id: 'p3', text: 'three' },
    ],
  },
};

// Turn 1 yields the root call; turn 2 waits until the request's signal aborts.
function rootThenWait(onWait: () => void): MockScript {
  return (turn) =>
    turn === 1
      ? { steps: [ROOT_STEP], end: 'tool-use' }
      : { steps: [{ type: 'wait', onWait }], end: 'tool-use' };
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof Generate>('@/contexts/ai/application/generate');
  mocks.generate.mockImplementation(actual.generate);
  mocks.requireUser.mockResolvedValue({ id: 'user-id', username: 'alice', isAdmin: false });
  useProvider();
});
afterEach(() => vi.resetAllMocks());

function expectNoProviderWork(): void {
  expect(streamOps).not.toHaveBeenCalled();
  expect(mocks.info).not.toHaveBeenCalled();
}

describe('POST /api/ai/generate checks', () => {
  it('Form-encoded body: 415 before session, service or provider', async () => {
    const request = post('topic=x&rootId=r1', {
      contentType: 'application/x-www-form-urlencoded',
    });
    const response = await POST(request);
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ error: 'unsupported-media-type' });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.aiService).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expectNoProviderWork();
  });

  it.each([
    ['Signed out', {}],
    [
      'Binding mismatch',
      { cookie: 'mindsprout_session=t', 'x-mindsprout-session-binding': 'other' },
    ],
    ['Empty binding', { cookie: 'mindsprout_session=t', 'x-mindsprout-session-binding': '' }],
  ])('%s: passes the 401 through before reading the body', async (_name, headers) => {
    const denied = Response.json({ error: 'unauthenticated' }, { status: 401 });
    mocks.requireUser.mockResolvedValue(denied);
    const request = post(JSON.stringify(VALID), { headers });
    const response = await POST(request);
    expect(mocks.requireUser).toHaveBeenCalledExactlyOnceWith(request);
    expect(response).toBe(denied);
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(request.bodyUsed).toBe(false);
    expect(mocks.aiService).not.toHaveBeenCalled();
    expectNoProviderWork();
  });

  it.each([
    ['Blank topic (spaces)', JSON.stringify({ topic: '   ', rootId: 'r1' })],
    ['Blank topic (ideographic space)', JSON.stringify({ topic: '　', rootId: 'r1' })],
    ['Oversized topic (201 ASCII)', JSON.stringify({ topic: 'a'.repeat(201), rootId: 'r1' })],
    ['Oversized topic (202 code units)', JSON.stringify({ topic: '𐀀'.repeat(101), rootId: 'r1' })],
    [
      'Oversized topic (201 raw, 199 trimmed)',
      JSON.stringify({ topic: `${'a'.repeat(199)}  `, rootId: 'r1' }),
    ],
    ['Unknown field', JSON.stringify({ ...VALID, extra: true })],
    ['invalid JSON', '{"topic":'],
    ['non-object body', '["Learning plan","r1"]'],
    ['wrong topic type', JSON.stringify({ topic: 42, rootId: 'r1' })],
    ['empty rootId', JSON.stringify({ topic: 'x', rootId: '' })],
    ['missing rootId', JSON.stringify({ topic: 'x' })],
  ])('%s: 400 invalid-input without a provider call', async (_name, body) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid-input' });
    expectNoProviderWork();
    expect(mocks.errorLog).not.toHaveBeenCalled();
  });

  it.each([
    ['200 ASCII code units', 'a'.repeat(200)],
    ['100 astral characters (200 code units)', '𐀀'.repeat(100)],
    ['200 raw code units with edge spaces, passed untrimmed', ` ${'a'.repeat(198)} `],
  ])('Longest topic accepted: %s', async (_name, topic) => {
    const response = await POST(post(JSON.stringify({ topic, rootId: 'r1' })));
    expect(response.status).toBe(200);
    await readFrames(response);
    expect(streamOps).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ topic, rootId: 'r1' }),
    );
  });

  it('AI disabled: 503 ai-unavailable', async () => {
    mocks.aiService.mockReturnValue(undefined);
    const response = await POST(post(JSON.stringify(VALID)));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'ai-unavailable' });
    expect(mocks.errorLog).not.toHaveBeenCalled();
  });

  it('validates the body before asking for the AI service', async () => {
    mocks.aiService.mockReturnValue(undefined);
    const response = await POST(post(JSON.stringify({ topic: '   ', rootId: 'r1' })));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid-input' });
    expect(mocks.aiService).not.toHaveBeenCalled();
  });

  it.each(['service', 'session'])(
    'returns a safe internal failure when the %s throws',
    async (source) => {
      const message = 'ANTHROPIC_API_KEY is required for the configured AI provider';
      if (source === 'service')
        mocks.aiService.mockImplementation(() => {
          throw new Error(message);
        });
      else mocks.requireUser.mockRejectedValue(new Error(message));
      const response = await POST(post(JSON.stringify(VALID)));
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: 'internal' });
      expect(text).not.toContain('ANTHROPIC_API_KEY');
      expect(mocks.errorLog).toHaveBeenCalledExactlyOnceWith({ event: 'ai.generate.failed' });
      expectNoProviderWork();
    },
  );
});

describe('POST /api/ai/generate stream', () => {
  it('Mock generation streams to done', async () => {
    const response = await POST(post(JSON.stringify(VALID)));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const frames = await readFrames(response);
    expect(frames.map((frame) => frame.event)).toEqual(['op', 'op', 'op', 'op', 'op', 'done']);
    expect(frames[5]?.data).toBe('{}');
    const ops = frames.slice(0, 5).map((frame) => parseTreeOp(JSON.parse(frame.data)));
    expect(ops.every((op) => op.op === 'add_children')).toBe(true);
    expect(ops[0]).toMatchObject({ op: 'add_children', parentId: 'r1' });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: 'ai.generate', outcome: 'done', ops: 5 }),
    );
  });

  it('Error after partial output', async () => {
    const response = await POST(
      post(JSON.stringify({ topic: 'mock:error-after-2', rootId: 'r1' })),
    );
    const text = await response.text();
    const frames = parseFrames(text);
    expect(frames.map((frame) => frame.event)).toEqual(['op', 'op', 'error']);
    expect(frames[2]?.data).toBe(
      '{"code":"provider-error","message":"The AI provider request failed"}',
    );
    expect(text).not.toContain('mock transport failed');
    expect(text).not.toContain('mock:error-after-2');
  });

  it('Stateless: a completed generation never touches the map store', async () => {
    const frames = await readFrames(await POST(post(JSON.stringify(VALID))));
    expect(frames.at(-1)?.event).toBe('done');
    expect(mocks.mapsForUser).not.toHaveBeenCalled();
  });

  it('Browser stops the request', async () => {
    const browser = new AbortController();
    useProvider(
      rootThenWait(() => {
        browser.abort();
      }),
    );
    const response = await POST(post(JSON.stringify(VALID), { signal: browser.signal }));
    expect(response.status).toBe(200);
    const reader = readerOf(response);
    const first = await reader.read();
    const frames = parseFrames(new TextDecoder().decode(first.value));
    expect(frames.map((frame) => frame.event)).toEqual(['op']);
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: 'aborted', attempts: 1, ops: 1 }),
    );
  });

  it('stops writing when Next cancels the response before aborting the request', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    const browser = new AbortController();
    const holder: {
      reader?: ReadableStreamDefaultReader<Uint8Array>;
      cancel?: Promise<void> | undefined;
    } = {};
    useProvider(
      rootThenWait(() => {
        holder.cancel = holder.reader?.cancel();
        browser.abort();
      }),
    );
    const response = await POST(post(JSON.stringify(VALID), { signal: browser.signal }));
    holder.reader = readerOf(response);
    await holder.reader.read();
    await vi.waitFor(() => {
      expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ outcome: 'aborted' }),
      );
    });
    expect(holder.cancel).toBeInstanceOf(Promise);
    await expect(holder.cancel).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', onRejection);
    expect(rejections).toEqual([]);
  });

  it('rethrows an unexpected error instead of mapping it to an error frame', async () => {
    const boom = new TypeError('boom');
    mocks.generate.mockImplementation(() => ({
      [Symbol.asyncIterator]() {
        return { next: () => Promise.reject(boom) };
      },
    }));
    const response = await POST(post(JSON.stringify(VALID)));
    expect(response.status).toBe(200);
    const reader = readerOf(response);
    await expect(reader.read()).rejects.toBe(boom);
  });

  it('ends an already-aborted request with no bytes and no provider call', async () => {
    const response = await POST(post(JSON.stringify(VALID), { signal: AbortSignal.abort() }));
    expect(response.status).toBe(200);
    const reader = readerOf(response);
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(streamOps).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: 'aborted', attempts: 0 }),
    );
  });
});
