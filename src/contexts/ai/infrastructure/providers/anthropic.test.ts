import type {
  BetaRawMessageStreamEvent,
  BetaStopReason,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
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
import { ProviderOutputError, ProviderTransportError } from '../../domain/errors';
import { createAnthropicProvider } from './anthropic';

// Hand-authored Messages SSE fixtures (Anthropic streaming wire format: message_start, then a
// content_block_start / _delta / _stop group per block, message_delta with the stop reason,
// message_stop), typed against the SDK's own BetaRawMessageStreamEvent so a shape drift fails
// typecheck. They are served through the injected `fetch` under the real SDK client; each fetch
// call is one model turn.

type StreamEvent = BetaRawMessageStreamEvent;
interface Call {
  parentId: string;
  children: { id: string; text: string }[];
}

const API_KEY = 'fixture-credential-302';
const MODEL = 'claude-opus-5-5';
const FALLBACK_MODEL = 'claude-fallback-fixture';
const ROOT_ID = 'primary-root';
const TOPIC = '学习 TypeScript';
const TOOL_NAME = GENERATE_TOOL_DEFINITION.name;
const SSE_INIT = { status: 200, headers: { 'content-type': 'text/event-stream' } };

function counterIds(prefix: string) {
  let issued = 0;
  return () => `${prefix}${String((issued += 1))}`;
}

function call(parentId: string, ...ids: string[]): Call {
  return { parentId, children: ids.map((id) => ({ id, text: `节点 ${id}` })) };
}

function messageStart(): StreamEvent {
  return {
    type: 'message_start',
    message: {
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      model: MODEL,
      content: [],
      container: null,
      context_management: null,
      diagnostics: null,
      stop_details: null,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        fallback_credit: null,
        inference_geo: null,
        input_tokens: 900,
        iterations: null,
        output_tokens: 1,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: 'standard',
        speed: null,
      },
    },
  };
}

// A tool_use block whose input arrives as `partial_json` chunks (eager input streaming starts the
// block with an empty `input`); `json` is split so the adapter must accumulate it.
function rawToolUse(index: number, id: string, json: string): StreamEvent[] {
  const cut = Math.floor(json.length / 2);
  return [
    {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name: TOOL_NAME, input: {} },
    },
    ...[json.slice(0, cut), json.slice(cut)].map((chunk): StreamEvent => ({
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: chunk },
    })),
    { type: 'content_block_stop', index },
  ];
}

function toolUse(index: number, id: string, input: Call): StreamEvent[] {
  return rawToolUse(index, id, JSON.stringify(input));
}

function textBlock(index: number, text: string): StreamEvent[] {
  return [
    {
      type: 'content_block_start',
      index,
      content_block: { type: 'text', text: '', citations: null },
    },
    { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index },
  ];
}

// A server-side fallback boundary: a start/stop pair with no deltas (BetaFallbackBlock).
const FALLBACK_BLOCK = {
  type: 'fallback',
  from: { model: MODEL },
  to: { model: FALLBACK_MODEL },
  trigger: { type: 'refusal', category: null },
} as const;

function fallbackBlock(index: number): StreamEvent[] {
  return [
    { type: 'content_block_start', index, content_block: FALLBACK_BLOCK },
    { type: 'content_block_stop', index },
  ];
}

function turnOf(blocks: StreamEvent[][], stopReason: BetaStopReason | null): StreamEvent[] {
  return [
    messageStart(),
    ...blocks.flat(),
    {
      type: 'message_delta',
      context_management: null,
      delta: { container: null, stop_details: null, stop_reason: stopReason, stop_sequence: null },
      usage: {
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        fallback_credit: null,
        input_tokens: null,
        iterations: null,
        output_tokens: 120,
        output_tokens_details: null,
        server_tool_use: null,
      },
    },
    { type: 'message_stop' },
  ];
}

function sse(events: readonly StreamEvent[]): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

type Reply = StreamEvent[] | Response | 'stall';

interface SentRequest {
  url: URL;
  headers: Headers;
  body: Record<string, unknown>;
  text: string;
}

// The injected transport: records each request and answers turn n with `reply(n)`. A stalled
// turn's body settles only when the request's own init.signal aborts.
function transport(reply: (turn: number) => Reply) {
  const sent: SentRequest[] = [];
  const box: { release?: () => void } = {};
  const waiting = new Promise<void>((resolve) => {
    box.release = resolve;
  });
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const text = typeof init?.body === 'string' ? init.body : '';
    sent.push({
      url: new URL(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: JSON.parse(text) as Record<string, unknown>,
      text,
    });
    const answer = reply(sent.length);
    if (answer instanceof Response) return Promise.resolve(answer);
    if (answer !== 'stall') return Promise.resolve(new Response(sse(answer), SSE_INIT));
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener(
          'abort',
          () => {
            controller.error(signal.reason);
          },
          { once: true },
        );
        box.release?.();
      },
    });
    return Promise.resolve(new Response(body, SSE_INIT));
  };
  return { fetch, sent, waiting };
}

function providerOver(fetch: ReturnType<typeof transport>['fetch'], baseURL?: string) {
  return createAnthropicProvider({
    apiKey: API_KEY,
    model: MODEL,
    idFactory: counterIds('srv-'),
    fetch,
    ...(baseURL === undefined ? {} : { baseURL }),
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

function sentAt(wire: { sent: SentRequest[] }, turn: number): SentRequest {
  const sent = wire.sent[turn - 1];
  if (sent === undefined) throw new Error(`turn ${String(turn)} was not requested`);
  return sent;
}

// Every ANTHROPIC_* variable is cleared, then the ones the SDK reads get decoys, so a client that
// falls back to the environment for its key, token, host or log level is caught.
beforeEach(() => {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('ANTHROPIC_')) vi.stubEnv(name, undefined);
  }
  vi.stubEnv('ANTHROPIC_API_KEY', 'env-decoy-api-key');
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'env-decoy-auth-token');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://env-decoy.invalid');
  vi.stubEnv('ANTHROPIC_LOG', 'debug');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Contract harness: canonical inputs become one tool_use block per call, a tool-use end becomes
// `tool_use` and a natural end `end_turn`.
function claudeHarness(scenario: ProviderScenarioName): ProviderHarness {
  const wire = transport((turn) => {
    const canonical = PROVIDER_SCENARIOS[scenario][turn - 1];
    if (canonical === undefined) throw new Error(`turn ${String(turn)} is not in ${scenario}`);
    if (canonical === 'stall') return 'stall';
    const blocks = canonical.calls.map((input, index) =>
      toolUse(index, `toolu_${String(turn)}_${String(index)}`, input),
    );
    return turnOf(blocks, canonical.end === 'tool-use' ? 'tool_use' : 'end_turn');
  });
  return {
    provider: providerOver(wire.fetch),
    turnsRequested: () => wire.sent.length,
    waiting: wire.waiting,
  };
}

describeProviderContract('anthropic', claudeHarness);

const ROOT_CALL = call('root', 'a', 'b');
const ROOT_TURN = turnOf([toolUse(0, 'toolu_root', ROOT_CALL)], 'tool_use');
const NATURAL_TURN = turnOf([toolUse(0, 'toolu_a', call('a', 'a1'))], 'end_turn');
const SINGLE_TURN = turnOf([toolUse(0, 'toolu_root', ROOT_CALL)], 'end_turn');

describe('Claude adapter: request', () => {
  it('sends the D4 settings, the shared prompt and tool, and the topic only in the user turn', async () => {
    const wire = sequence([SINGLE_TURN]);

    await attempt(providerOver(wire.fetch).streamOps(request()));

    const { body, headers, url } = sentAt(wire, 1);
    expect(body).toStrictEqual({
      model: MODEL,
      max_tokens: 8000,
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: GENERATE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      tools: [
        {
          name: GENERATE_TOOL_DEFINITION.name,
          description: GENERATE_TOOL_DEFINITION.description,
          input_schema: GENERATE_TOOL_DEFINITION.inputSchema,
          strict: true,
          eager_input_streaming: true,
        },
      ],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: TOPIC }],
      stream: true,
    });
    expect(JSON.stringify({ ...body, messages: [] })).not.toContain(TOPIC);
    expect(headers.get('anthropic-beta')?.split(',')).toContain('server-side-fallback-2026-07-01');
    expect(url.origin + url.pathname).toBe('https://api.anthropic.com/v1/messages');
  });

  it('sends the key only as x-api-key and never reads ANTHROPIC_* or logs', async () => {
    const logged = (['debug', 'info', 'log', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const wire = sequence([ROOT_TURN, NATURAL_TURN]);

    await attempt(providerOver(wire.fetch).streamOps(request()));

    expect(wire.sent).toHaveLength(2);
    for (const sent of wire.sent) {
      expect(sent.headers.get('x-api-key')).toBe(API_KEY);
      expect(sent.headers.has('authorization')).toBe(false);
      const others = [...sent.headers].filter(([name]) => name !== 'x-api-key');
      expect(JSON.stringify(others)).not.toContain(API_KEY);
      expect(JSON.stringify(others)).not.toContain('env-decoy');
      expect(sent.text).not.toContain(API_KEY);
      expect(sent.url.href).not.toContain(API_KEY);
    }
    for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  });

  it('uses the injected baseURL host', async () => {
    const wire = sequence([SINGLE_TURN]);

    await attempt(providerOver(wire.fetch, 'https://gateway.example.test').streamOps(request()));

    const { url } = sentAt(wire, 1);
    expect(url.origin + url.pathname).toBe('https://gateway.example.test/v1/messages');
  });
});

describe('Claude adapter: turn loop', () => {
  it('follows a tool_use turn with its assistant content and one ok tool_result per call', async () => {
    const firstCalls = [ROOT_CALL, call('a', 'a1', 'a2')];
    const wire = sequence([
      turnOf(
        [
          textBlock(0, '先建根节点'),
          toolUse(1, 'toolu_1', ROOT_CALL),
          toolUse(2, 'toolu_2', call('a', 'a1', 'a2')),
        ],
        'tool_use',
      ),
      turnOf([toolUse(0, 'toolu_3', call('b', 'b1'))], 'end_turn'),
    ]);

    const result = await attempt(providerOver(wire.fetch).streamOps(request()));

    expect(result.error).toBeUndefined();
    expect(result.emitted).toHaveLength(3);
    const first = sentAt(wire, 1).body;
    const second = sentAt(wire, 2).body;
    expect(second.messages).toStrictEqual([
      { role: 'user', content: TOPIC },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '先建根节点', citations: null },
          { type: 'tool_use', id: 'toolu_1', name: TOOL_NAME, input: firstCalls[0] },
          { type: 'tool_use', id: 'toolu_2', name: TOOL_NAME, input: firstCalls[1] },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' },
        ],
      },
    ]);
    expect({ ...second, messages: [] }).toStrictEqual({ ...first, messages: [] });
  });

  it('starts every attempt from the topic alone', async () => {
    const wire = sequence([ROOT_TURN, NATURAL_TURN, ROOT_TURN, NATURAL_TURN]);
    const provider = providerOver(wire.fetch);

    const one = await attempt(provider.streamOps(request()));
    const two = await attempt(provider.streamOps(request()));

    expect(one.emitted).toHaveLength(2);
    expect(two.emitted).toHaveLength(2);
    expect(sentAt(wire, 3).body.messages).toStrictEqual([{ role: 'user', content: TOPIC }]);
  });

  it('maps stop_sequence to a natural end after 1 turn', async () => {
    const wire = sequence([
      turnOf([toolUse(0, 'toolu_root', ROOT_CALL)], 'stop_sequence'),
      ROOT_TURN,
    ]);

    const result = await attempt(providerOver(wire.fetch).streamOps(request()));

    expect(result.error).toBeUndefined();
    expect(result.emitted).toHaveLength(1);
    expect(wire.sent).toHaveLength(1);
  });

  it.each([['pause_turn' as const], [null]])(
    'rejects stop reason %s as a transport error after its ops',
    async (stopReason) => {
      const wire = sequence([turnOf([toolUse(0, 'toolu_root', ROOT_CALL)], stopReason), ROOT_TURN]);

      const result = await attempt(providerOver(wire.fetch).streamOps(request()));

      expect(result.emitted).toHaveLength(1);
      expect(result.error).toBeInstanceOf(ProviderTransportError);
      expect(wire.sent).toHaveLength(1);
    },
  );
});

describe('Claude adapter: tool input and fallback', () => {
  it('rejects a truncated partial_json at block stop as invalid output, never repaired', async () => {
    // The SDK's partial-JSON parse would complete this to a schema-valid call.
    const truncated = '{"parentId":"root","children":[{"id":"a","text":"节点 a"}';
    const wire = sequence([turnOf([rawToolUse(0, 'toolu_cut', truncated)], 'tool_use')]);

    const result = await attempt(providerOver(wire.fetch).streamOps(request()));

    expect(result.emitted).toStrictEqual([]);
    expect(result.error).toBeInstanceOf(ProviderOutputError);
    expect((result.error as Error).message).not.toContain('节点');
    expect(wire.sent).toHaveLength(1);
  });

  it('withholds the raw model JSON when the SDK rejects malformed input', async () => {
    const malformed = '{"parentId":"root","children":[{"id":"a","text":"leak-marker"}]}}';
    const wire = sequence([turnOf([rawToolUse(0, 'toolu_bad', malformed)], 'tool_use')]);

    const result = await attempt(providerOver(wire.fetch).streamOps(request()));

    expect(result.emitted).toStrictEqual([]);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).not.toContain('leak-marker');
    expect((result.error as Error).cause).toBeUndefined();
  });

  it('replays a fallback-first turn with the fallback block in place and acks only the later call', async () => {
    const wire = sequence([
      turnOf([fallbackBlock(0), toolUse(1, 'toolu_after', ROOT_CALL)], 'tool_use'),
      NATURAL_TURN,
    ]);

    const result = await attempt(providerOver(wire.fetch).streamOps(request()));

    expect(result.error).toBeUndefined();
    expect(result.emitted).toHaveLength(2);
    expect(sentAt(wire, 2).body.messages).toStrictEqual([
      { role: 'user', content: TOPIC },
      {
        role: 'assistant',
        content: [
          FALLBACK_BLOCK,
          { type: 'tool_use', id: 'toolu_after', name: TOOL_NAME, input: ROOT_CALL },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_after', content: 'ok' }],
      },
    ]);
  });

  it('rejects a fallback block after an emitted op as a transport error', async () => {
    const wire = sequence([
      turnOf(
        [
          toolUse(0, 'toolu_root', ROOT_CALL),
          fallbackBlock(1),
          toolUse(2, 'toolu_a', call('a', 'a1')),
        ],
        'tool_use',
      ),
      NATURAL_TURN,
    ]);

    const result = await attempt(providerOver(wire.fetch).streamOps(request()));

    expect(result.emitted).toHaveLength(1);
    expect(result.error).toBeInstanceOf(ProviderTransportError);
    expect(wire.sent).toHaveLength(1);
  });
});

describe('Claude adapter: HTTP failure', () => {
  it('requests a retryable 529 exactly once and rejects without its body', async () => {
    const overloaded = new Response(
      JSON.stringify({
        type: 'error',
        error: { type: 'overloaded_error', message: 'body-marker' },
      }),
      { status: 529, headers: { 'content-type': 'application/json', 'x-should-retry': 'true' } },
    );
    const wire = sequence([overloaded, ROOT_TURN]);

    const result = await attempt(providerOver(wire.fetch).streamOps(request()));

    expect(wire.sent).toHaveLength(1);
    expect(result.emitted).toStrictEqual([]);
    expect(result.error).toBeInstanceOf(ProviderTransportError);
    expect((result.error as Error).message).not.toContain('body-marker');
  });
});
