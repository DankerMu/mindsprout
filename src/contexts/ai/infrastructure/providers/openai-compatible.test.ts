import { tracingChannel } from 'node:diagnostics_channel';
import { registerTelemetry, type Telemetry } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeProviderContract,
  PROVIDER_SCENARIOS,
  type ProviderHarness,
  type ProviderScenarioName,
} from '../../../../../tests/support/provider-contract';
import type { TreeOp } from '../../acl/map';
import {
  GENERATE_SYSTEM_PROMPT,
  GENERATE_TOOL_DEFINITION,
} from '../../application/generate-prompt';
import {
  ProviderOutputError,
  ProviderRefusedError,
  ProviderTransportError,
} from '../../domain/errors';
import { createOpenAICompatibleProvider } from './openai-compatible';

// Hand-authored chat-completions SSE fixtures (OpenAI streaming wire format: `data:` chunks whose
// `choices[0].delta.tool_calls` carry `index`, `id`, `function.name` and `arguments` fragments, a
// chunk with `finish_reason`, then `data: [DONE]`). They are served through the injected `fetch`
// under the real AI SDK; each fetch call is one model turn.

interface Call {
  parentId: string;
  children: { id: string; text: string }[];
}

// One wire tool call: its id and its raw `arguments` text (valid, truncated or malformed JSON).
interface WireCall {
  id: string;
  args: string;
  name?: string;
}

const API_KEY = 'fixture-credential-301';
const MODEL = 'deepseek-v4.1-flash-1017';
const BASE_URL = 'https://gateway.example.test/v1';
const ROOT_ID = 'primary-root';
const TOPIC = '学习 TypeScript';
const TOOL_NAME = GENERATE_TOOL_DEFINITION.name;
const SSE_INIT = { status: 200, headers: { 'content-type': 'text/event-stream' } };
const DONE = 'data: [DONE]\n\n';

function counterIds(prefix: string) {
  let issued = 0;
  return () => `${prefix}${String((issued += 1))}`;
}

function call(parentId: string, ...ids: string[]): Call {
  return { parentId, children: ids.map((id) => ({ id, text: `节点 ${id}` })) };
}

function wire(id: string, input: Call): WireCall {
  return { id, args: JSON.stringify(input) };
}

function data(delta: object, finishReason: string | null = null): string {
  const chunk = {
    id: 'chatcmpl-fixture',
    object: 'chat.completion.chunk',
    created: 1764201600,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

// The first delta names the call with empty arguments; the arguments follow in two fragments, so
// the SDK must accumulate them by `index`.
function toolCallChunks(index: number, { id, args, name = TOOL_NAME }: WireCall): string[] {
  const cut = Math.floor(args.length / 2);
  return [
    data({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }] }),
    ...[args.slice(0, cut), args.slice(cut)].map((fragment) =>
      data({ tool_calls: [{ index, function: { arguments: fragment } }] }),
    ),
  ];
}

// A whole turn body. `finish` null sends no `finish_reason` chunk; `done` false omits `[DONE]`.
function turnSse(
  calls: readonly WireCall[],
  finish: string | null,
  { lead = [], done = true }: { lead?: object[]; done?: boolean } = {},
): string {
  return [
    data({ role: 'assistant', content: '' }),
    ...lead.map((delta) => data(delta)),
    ...calls.flatMap((wireCall, index) => toolCallChunks(index, wireCall)),
    ...(finish === null ? [] : [data({}, finish)]),
    ...(done ? [DONE] : []),
  ].join('');
}

// A string is a whole SSE body; `stall` holds its body open, sending nothing, and errors it when
// the request's init.signal aborts; `broken` sends its prefix and then fails the body read.
type Reply = string | Response | { stall: true } | { broken: string };

interface SentRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
  text: string;
  signal: AbortSignal | undefined;
}

const BODY_FAILURE = 'socket-reset-marker';

function heldBody(signal: AbortSignal | undefined, started: () => void) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener(
        'abort',
        () => {
          controller.error(signal.reason);
        },
        { once: true },
      );
      started();
    },
  });
}

function brokenBody(prefix: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(prefix));
      controller.error(new Error(BODY_FAILURE));
    },
  });
}

function recorded(input: string | URL | Request, init?: RequestInit): SentRequest {
  const text = typeof init?.body === 'string' ? init.body : '';
  return {
    url: input instanceof Request ? input.url : String(input),
    headers: new Headers(init?.headers),
    body: JSON.parse(text) as Record<string, unknown>,
    text,
    signal: init?.signal ?? undefined,
  };
}

function respond(answer: Reply, signal: AbortSignal | undefined, started: () => void): Response {
  if (answer instanceof Response) return answer;
  if (typeof answer === 'string') return new Response(answer, SSE_INIT);
  if ('broken' in answer) return new Response(brokenBody(answer.broken), SSE_INIT);
  return new Response(heldBody(signal, started), SSE_INIT);
}

// The injected transport: records each request and answers turn n with `reply(n)`. A stalled
// turn ends on abort both through its body (init.signal errors it) and through the SDK's own
// abort handling, which cancels its read; only the recorded init.signal shows the wire abort.
function transport(reply: (turn: number) => Reply) {
  const sent: SentRequest[] = [];
  const box: { release?: () => void } = {};
  const waiting = new Promise<void>((resolve) => {
    box.release = resolve;
  });
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = recorded(input, init);
    sent.push(request);
    return Promise.resolve(respond(reply(sent.length), request.signal, () => box.release?.()));
  };
  return { fetch, sent, waiting };
}

function providerOver(fetch: ReturnType<typeof transport>['fetch']) {
  return createOpenAICompatibleProvider({
    apiKey: API_KEY,
    model: MODEL,
    baseURL: BASE_URL,
    idFactory: counterIds('srv-'),
    fetch,
  });
}

function sequence(turns: readonly Reply[]) {
  return transport((turn) => {
    const answer = turns[turn - 1];
    if (answer === undefined) throw new Error(`turn ${String(turn)} has no fixture`);
    return answer;
  });
}

function request(signal: AbortSignal = new AbortController().signal) {
  return { topic: TOPIC, rootId: ROOT_ID, signal };
}

async function attempt(ops: AsyncIterable<TreeOp>) {
  const emitted: TreeOp[] = [];
  try {
    for await (const op of ops) emitted.push(op);
    return { emitted, error: undefined };
  } catch (error) {
    return { emitted, error };
  }
}

function sentAt(sent: readonly SentRequest[], turn: number): SentRequest {
  const found = sent[turn - 1];
  if (found === undefined) throw new Error(`turn ${String(turn)} was not requested`);
  return found;
}

const ROOT_CALL = call('root', 'a', 'b');
const ROOT_WIRE = wire('call_root', ROOT_CALL);
const ROOT_TURN = turnSse([ROOT_WIRE], 'tool_calls');

// One fixture turn with a sentinel tool-calls turn behind it, so a second request is counted.
async function oneTurn(reply: Reply) {
  const { fetch, sent } = sequence([reply, ROOT_TURN]);
  const result = await attempt(providerOver(fetch).streamOps(request()));
  return { ...result, sent };
}

// Every test runs with a global fetch that throws and console methods that record: the adapter
// must reach the network only through the injected fetch (never the AI gateway) and log nothing.
let globalFetch: ReturnType<typeof vi.fn>;
let logged: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  globalFetch = vi.fn(() => {
    throw new Error('global fetch is not a transport');
  });
  vi.stubGlobal('fetch', globalFetch);
  logged = (['error', 'warn', 'log'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  expect(globalFetch).not.toHaveBeenCalled();
  for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Contract harness: canonical inputs become one wire tool call per call, a tool-use end becomes
// `tool_calls` and a natural end `stop`.
function openAICompatibleHarness(scenario: ProviderScenarioName): ProviderHarness {
  const { fetch, sent, waiting } = transport((turn) => {
    const canonical = PROVIDER_SCENARIOS[scenario][turn - 1];
    if (canonical === undefined) throw new Error(`turn ${String(turn)} is not in ${scenario}`);
    if (canonical === 'stall') return { stall: true };
    const calls = canonical.calls.map((input, index) =>
      wire(`call_${String(turn)}_${String(index)}`, input),
    );
    return turnSse(calls, canonical.end === 'tool-use' ? 'tool_calls' : 'stop');
  });
  return { provider: providerOver(fetch), turnsRequested: () => sent.length, waiting };
}

describeProviderContract('openai-compatible', openAICompatibleHarness);

const SYSTEM_AND_TOPIC = [
  { role: 'system', content: GENERATE_SYSTEM_PROMPT },
  { role: 'user', content: TOPIC },
];

describe('OpenAI-compatible adapter: request', () => {
  it('sends the D4 settings, the shared prompt and tool, and the topic only in the user message', async () => {
    const { fetch, sent } = sequence([turnSse([ROOT_WIRE], 'stop')]);

    const result = await attempt(providerOver(fetch).streamOps(request()));

    expect(result.error).toBeUndefined();
    expect(sent).toHaveLength(1);
    const { body, url } = sentAt(sent, 1);
    expect(body).toStrictEqual({
      model: MODEL,
      max_tokens: 8000,
      messages: SYSTEM_AND_TOPIC,
      tools: [
        {
          type: 'function',
          function: {
            name: GENERATE_TOOL_DEFINITION.name,
            description: GENERATE_TOOL_DEFINITION.description,
            parameters: GENERATE_TOOL_DEFINITION.inputSchema,
          },
        },
      ],
      tool_choice: 'auto',
      stream: true,
    });
    expect(JSON.stringify({ ...body, messages: SYSTEM_AND_TOPIC.slice(0, 1) })).not.toContain(
      TOPIC,
    );
    expect(url).toBe(`${BASE_URL}/chat/completions`);
  });

  it('sends the key only as Authorization: Bearer on every turn', async () => {
    const { fetch, sent } = sequence([
      ROOT_TURN,
      turnSse([wire('call_a', call('a', 'a1'))], 'stop'),
    ]);

    await attempt(providerOver(fetch).streamOps(request()));

    expect(sent).toHaveLength(2);
    for (const { headers, text, url } of sent) {
      expect(headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
      const others = [...headers].filter(([name]) => name !== 'authorization');
      expect(JSON.stringify(others)).not.toContain(API_KEY);
      expect(text).not.toContain(API_KEY);
      expect(url).not.toContain(API_KEY);
    }
  });
});

describe('OpenAI-compatible adapter: turn loop', () => {
  it('follows a tool-calls turn with the assistant message and one ok tool message per call id', async () => {
    const second = call('a', 'a1', 'a2');
    const { fetch, sent } = sequence([
      turnSse([ROOT_WIRE, wire('call_a', second)], 'tool_calls', {
        lead: [{ reasoning_content: '根下先放两枝' }],
      }),
      turnSse([wire('call_b', call('b', 'b1'))], 'stop'),
    ]);

    const result = await attempt(providerOver(fetch).streamOps(request()));

    expect(result.error).toBeUndefined();
    expect(result.emitted).toHaveLength(3);
    expect(sent).toHaveLength(2);
    const first = sentAt(sent, 1).body;
    const next = sentAt(sent, 2).body;
    expect(next.messages).toStrictEqual([
      ...SYSTEM_AND_TOPIC,
      {
        role: 'assistant',
        content: null,
        reasoning_content: '根下先放两枝',
        tool_calls: [
          {
            id: 'call_root',
            type: 'function',
            function: { name: TOOL_NAME, arguments: JSON.stringify(ROOT_CALL) },
          },
          {
            id: 'call_a',
            type: 'function',
            function: { name: TOOL_NAME, arguments: JSON.stringify(second) },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_root', content: 'ok' },
      { role: 'tool', tool_call_id: 'call_a', content: 'ok' },
    ]);
    expect({ ...next, messages: [] }).toStrictEqual({ ...first, messages: [] });
  });

  it('starts every attempt from the topic alone', async () => {
    const natural = turnSse([wire('call_a', call('a', 'a1'))], 'stop');
    const { fetch, sent } = sequence([ROOT_TURN, natural, ROOT_TURN, natural]);
    const provider = providerOver(fetch);

    const one = await attempt(provider.streamOps(request()));
    const two = await attempt(provider.streamOps(request()));

    expect(one.emitted).toHaveLength(2);
    expect(two.emitted).toHaveLength(2);
    expect(sentAt(sent, 3).body.messages).toStrictEqual(SYSTEM_AND_TOPIC);
  });

  it('ends naturally at length when every tool input is complete, after 1 turn', async () => {
    const result = await oneTurn(turnSse([ROOT_WIRE, wire('call_a', call('a', 'a1'))], 'length'));

    expect(result.error).toBeUndefined();
    expect(result.emitted.map((op) => op.op)).toStrictEqual(['add_children', 'add_children']);
    expect(result.sent).toHaveLength(1);
  });
});

// Unparseable arguments: the SDK finalises every call at the stream end and marks this one invalid.
const TRUNCATED = '{"parentId":"root","chil';
const CUT_WIRE: WireCall = { id: 'call_cut', args: TRUNCATED };

// An expected failure: its class and its fixed message.
type Failure = readonly [
  typeof ProviderOutputError | typeof ProviderRefusedError | typeof ProviderTransportError,
  string,
];
const INVALID: Failure = [
  ProviderOutputError,
  'OpenAI-compatible tool call is unfinished, malformed or unknown',
];
const REFUSED: Failure = [ProviderRefusedError, 'OpenAI-compatible model refused'];
const UNFINISHED: Failure = [
  ProviderTransportError,
  'OpenAI-compatible turn ended without a supported finish',
];
// The SDK reports a stream without finish_reason as an error part, so it is a failed request.
const FAILED: Failure = [ProviderTransportError, 'OpenAI-compatible request failed'];

function expectFailure(
  result: { emitted: TreeOp[]; error: unknown; sent: SentRequest[] },
  [kind, message]: Failure,
) {
  expect(result.emitted).toStrictEqual([]);
  expect(result.error).toBeInstanceOf(kind);
  expect((result.error as Error).message).toBe(message);
  expect((result.error as Error).cause).toBeUndefined();
  expect(result.sent).toHaveLength(1);
}

describe('OpenAI-compatible adapter: turn-end verdict', () => {
  it.each<[string, Reply, Failure]>([
    ['truncated arguments at length', turnSse([CUT_WIRE], 'length'), INVALID],
    [
      'malformed arguments at tool_calls',
      turnSse([{ id: 'call_bad', args: '{"parentId":"root","children":[]}}' }], 'tool_calls'),
      INVALID,
    ],
    [
      'a call to an unknown tool',
      turnSse(
        [{ id: 'call_x', args: JSON.stringify(ROOT_CALL), name: 'other_tool' }],
        'tool_calls',
      ),
      INVALID,
    ],
    // The SDK turns empty arguments into a valid call with input {}; the assembler rejects it.
    [
      'empty arguments at tool_calls',
      turnSse([{ id: 'call_empty', args: '' }], 'tool_calls'),
      [ProviderOutputError, 'tool input does not match the add_children schema'],
    ],
    ['finish_reason content_filter', turnSse([], 'content_filter'), REFUSED],
    ['content_filter after truncated arguments', turnSse([CUT_WIRE], 'content_filter'), REFUSED],
    [
      'stop with a refusal delta',
      turnSse([], 'stop', { lead: [{ refusal: 'I cannot help with that.' }] }),
      REFUSED,
    ],
    ['a stream without finish_reason', turnSse([], null), FAILED],
    ['an unknown finish_reason', turnSse([], 'paused'), UNFINISHED],
    ['truncated arguments without finish_reason', turnSse([CUT_WIRE], null), FAILED],
  ])('rejects %s with zero ops after one request', async (_, reply, failure) => {
    expectFailure(await oneTurn(reply), failure);
  });

  // Each turn starts with one complete valid root call: an adapter that yields while reading would
  // emit its op before the turn's verdict.
  it.each<[string, string | null, WireCall[], Failure]>([
    ['a truncated call at length', 'length', [CUT_WIRE], INVALID],
    ['content_filter', 'content_filter', [], REFUSED],
    ['no finish_reason', null, [], FAILED],
    ['an unknown finish_reason', 'paused', [], UNFINISHED],
  ])('buffers a valid call before %s: zero ops', async (_, finish, rest, failure) => {
    expectFailure(await oneTurn(turnSse([ROOT_WIRE, ...rest], finish)), failure);
  });

  it('rejects a body that fails after one complete call as a transport error with zero ops', async () => {
    const prefix = turnSse([ROOT_WIRE], null, { done: false });

    const result = await oneTurn({ broken: prefix });

    expectFailure(result, FAILED);
    const error = result.error as Error;
    expect(`${error.message}\n${String(error.stack)}`).not.toContain(BODY_FAILURE);
  });
});

const REQUEST_ID = 'req_fixture_301';

// ai-provider "Provider HTTP error body withheld": the body carries the key and the request id.
describe('OpenAI-compatible adapter: HTTP failure', () => {
  it('requests a 500 exactly once and rejects without its body, key, request id or topic', async () => {
    const failed = new Response(
      JSON.stringify({
        error: {
          message: `body-marker ${API_KEY} ${REQUEST_ID}`,
          type: 'server_error',
          code: 'internal_error',
        },
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json', 'x-request-id': REQUEST_ID },
      },
    );

    const result = await oneTurn(failed);

    expectFailure(result, FAILED);
    const error = result.error as Error;
    for (const leaked of ['body-marker', API_KEY, REQUEST_ID, TOPIC]) {
      expect(`${error.message}\n${String(error.stack)}`).not.toContain(leaked);
    }
    for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  });
});

describe('OpenAI-compatible adapter: abort', () => {
  it('aborts a stalled turn on the wire: the request init.signal is aborted', async () => {
    const { fetch, sent, waiting } = sequence([{ stall: true }]);
    const controller = new AbortController();
    const pending = attempt(providerOver(fetch).streamOps(request(controller.signal)));
    await waiting;
    const reason = new Error('adapter abort');

    controller.abort(reason);
    const result = await pending;

    expect(result.emitted).toStrictEqual([]);
    expect(result.error).toBe(reason);
    expect(sent).toHaveLength(1);
    expect(sentAt(sent, 1).signal?.aborted).toBe(true);
  });
});

// Records every lifecycle callback it receives by name; it forwards model calls unchanged.
function recordingTelemetry(names: string[]): Telemetry {
  const record = (name: string) => () => {
    names.push(name);
  };
  return {
    onStart: record('onStart'),
    onLanguageModelCallStart: record('onLanguageModelCallStart'),
    onStepEnd: record('onStepEnd'),
    onEnd: record('onEnd'),
    executeLanguageModelCall({ execute }) {
      names.push('executeLanguageModelCall');
      return execute();
    },
  };
}

// The SDK's telemetry is opt-out: a global integration and an `ai:telemetry` tracing-channel
// subscriber would both receive the topic and the model output unless the call disables it.
describe('OpenAI-compatible adapter: telemetry', () => {
  it('reaches no global integration and no tracing-channel subscriber over two turns', async () => {
    const integration: string[] = [];
    const channel: string[] = [];
    const traced = tracingChannel('ai:telemetry');
    const onTraceStart = (message: unknown) => {
      channel.push(String((message as { type?: unknown }).type));
    };
    const previous = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS;
    traced.start.subscribe(onTraceStart);
    registerTelemetry(recordingTelemetry(integration));
    try {
      const { fetch, sent } = sequence([
        ROOT_TURN,
        turnSse([wire('call_a', call('a', 'a1'))], 'stop'),
      ]);

      const result = await attempt(providerOver(fetch).streamOps(request()));

      expect(result.error).toBeUndefined();
      expect(sent).toHaveLength(2);
      expect({ integration, channel }).toStrictEqual({ integration: [], channel: [] });
    } finally {
      globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = previous;
      traced.start.unsubscribe(onTraceStart);
    }
  });
});
