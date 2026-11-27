import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaStopReason,
  BetaTool,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { NodeId } from '../../acl/map';
import { buildGenerateRequest, GENERATE_TOOL_DEFINITION } from '../../application/generate-prompt';
import type { GenerateRequest, Provider } from '../../application/provider';
import { runTurnLoop, type TurnEnd, type TurnItem } from '../../application/turn-loop';
import { ProviderOutputError, ProviderTransportError } from '../../domain/errors';
import { PRODUCTION_CAPS } from '../../domain/generate-tool';

// The Claude adapter (design D3, D4): one `client.beta.messages.stream` per turn, driven by the
// shared turn loop. Failure classification beyond this slice (refusal, max_tokens, HTTP status,
// malformed input JSON) is task 3.4.

interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  // Gateway origin such as dmxapi; unset means the SDK default host.
  baseURL?: string;
  idFactory: () => NodeId;
  // Transport under the real SDK client: tests inject SSE fixtures; composition leaves it unset.
  fetch?: ClientOptions['fetch'];
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOKENS_PER_TURN = 8000;

// The shared definition (D6), mapped to `input_schema`, plus the D4 transport flags.
const GENERATE_TOOL: BetaTool = {
  name: GENERATE_TOOL_DEFINITION.name,
  description: GENERATE_TOOL_DEFINITION.description,
  input_schema: GENERATE_TOOL_DEFINITION.inputSchema,
  strict: true,
  eager_input_streaming: true,
};

function requestBody(
  model: string,
  system: string,
  messages: readonly BetaMessageParam[],
): BetaMessageStreamParams {
  return {
    model,
    max_tokens: MAX_TOKENS_PER_TURN,
    // The SDK sends `betas` as the anthropic-beta header, never in the body.
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: [GENERATE_TOOL],
    tool_choice: { type: 'auto' },
    messages: [...messages],
  };
}

// D3 turn-end mapping for this slice; 3.4 refines `refusal` and `max_tokens`.
function turnEnd(reason: BetaStopReason | null): TurnEnd {
  if (reason === 'tool_use') return 'tool-use';
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'natural';
  throw new ProviderTransportError('Claude turn ended with an unsupported stop reason');
}

// One turn's tool inputs by content index. `json` holds the `partial_json` text of each open
// tool_use block; `inputs` the strict parse of each stopped one. The SDK's `block.input` is never
// read: it is a partial-JSON parse that silently completes truncated input.
interface TurnInputs {
  json: Map<number, string>;
  inputs: Map<number, unknown>;
}

function parseStrict(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    // Swallows the SyntaxError: its message quotes the model output.
    throw new ProviderOutputError('Claude tool input is not valid JSON');
  }
}

// Returns the tool input completed by `event`, if any.
function acceptEvent(event: BetaRawMessageStreamEvent, turn: TurnInputs): TurnItem | undefined {
  if (event.type === 'content_block_start') {
    const { type } = event.content_block;
    if (type === 'tool_use') turn.json.set(event.index, '');
    // An emitted op cannot be withdrawn, so a fallback hop after one ends the attempt.
    if (type === 'fallback' && turn.inputs.size > 0) {
      throw new ProviderTransportError('Claude fell back after a tool input was yielded');
    }
  } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
    const json = turn.json.get(event.index);
    if (json !== undefined) turn.json.set(event.index, json + event.delta.partial_json);
  } else if (event.type === 'content_block_stop') {
    const json = turn.json.get(event.index);
    if (json === undefined) return undefined;
    turn.json.delete(event.index);
    const input = parseStrict(json);
    turn.inputs.set(event.index, input);
    return { type: 'tool-input', input };
  }
  return undefined;
}

// Block types dropped before the last fallback block on replay (vendor "Continuing the
// conversation" table). `connector_text` is not in the SDK's content union, hence a string set.
const DROPPED_BEFORE_FALLBACK: ReadonlySet<string> = new Set([
  'thinking',
  'redacted_thinking',
  'connector_text',
]);

// Turn n's assistant content as received (fallback blocks in place) minus the blocks above before
// the last fallback block, with each tool_use input replaced by its strict parse, then one `ok`
// tool_result per tool_use, in order. A turn that kept a tool_use before a fallback block has
// already rejected, so every acked call follows the last fallback.
function acknowledged(content: readonly BetaContentBlock[], turn: TurnInputs): BetaMessageParam[] {
  const lastFallback = content.map((block) => block.type).lastIndexOf('fallback');
  const replay = content.flatMap((block, index): BetaContentBlockParam[] => {
    if (index < lastFallback && DROPPED_BEFORE_FALLBACK.has(block.type)) return [];
    if (block.type !== 'tool_use') return [block];
    return [{ type: 'tool_use', id: block.id, name: block.name, input: turn.inputs.get(index) }];
  });
  const acks = content.flatMap((block): BetaToolResultBlockParam[] =>
    block.type === 'tool_use'
      ? [{ type: 'tool_result', tool_use_id: block.id, content: 'ok' }]
      : [],
  );
  return [
    { role: 'assistant', content: replay },
    { role: 'user', content: acks },
  ];
}

// Streams one request. The stream is iterated as soon as it is created, so the SDK always has an
// error listener; a consumer stop at a yield closes the iterator, which aborts the request. The
// final message rethrows errors the event iterator swallows. Every error aborts the request first:
// an error the SDK reports itself (such as malformed tool input at block stop) rejects the
// iterator without closing it, and the body would keep streaming. SDK errors become a
// fixed-message transport error because their messages quote response bodies and model output.
async function* streamTurn(
  client: Anthropic,
  body: BetaMessageStreamParams,
  signal: AbortSignal,
  turn: TurnInputs,
): AsyncGenerator<TurnItem, BetaMessage, undefined> {
  const stream = client.beta.messages.stream(body, { signal });
  try {
    for await (const event of stream) {
      const item = acceptEvent(event, turn);
      if (item !== undefined) yield item;
    }
    return await stream.finalMessage();
  } catch (error) {
    stream.abort();
    if (error instanceof ProviderOutputError || error instanceof ProviderTransportError)
      throw error;
    throw new ProviderTransportError('Claude request failed');
  }
}

// One attempt's `runTurn`: the history starts from the topic alone and grows by the assistant
// turn and its acks after every tool_use turn.
function attemptTurns(client: Anthropic, model: string, request: GenerateRequest) {
  const prompt = buildGenerateRequest(request.topic);
  const history: BetaMessageParam[] = [...prompt.messages];
  return async function* runTurn(): AsyncGenerator<TurnItem, TurnEnd, undefined> {
    const turn: TurnInputs = { json: new Map(), inputs: new Map() };
    const body = requestBody(model, prompt.system, history);
    const message = yield* streamTurn(client, body, request.signal, turn);
    const end = turnEnd(message.stop_reason);
    if (end === 'tool-use') history.push(...acknowledged(message.content, turn));
    return end;
  };
}

export function createAnthropicProvider({
  apiKey,
  model,
  baseURL,
  idFactory,
  fetch,
}: AnthropicProviderOptions): Provider {
  const client = new Anthropic({
    // Passed so the SDK never reads ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or the on-disk
    // credential chain for a key.
    apiKey,
    // SDK 1.13 sends `apiKey` as `Authorization: Bearer`; the key travels only as x-api-key
    // (defaultHeaders merge after the SDK's auth headers and ANTHROPIC_CUSTOM_HEADERS, and null
    // removes one). Other names in ANTHROPIC_CUSTOM_HEADERS are still sent.
    defaultHeaders: { 'x-api-key': apiKey, authorization: null },
    // null, not undefined: an unset baseURL is the SDK default host, never ANTHROPIC_BASE_URL.
    baseURL: baseURL ?? null,
    // Each SDK retry is another billed request; generate (D5) owns the single retry.
    maxRetries: 0,
    // The SDK's debug log prints request and response bodies, which carry the topic.
    logLevel: 'off',
    // Given, so the SDK ignores ANTHROPIC_OPEN_TELEMETRY*: its spans can carry the topic and model
    // output (content mode), and design D5 defers spans.
    openTelemetry: false,
    fetch,
  });
  return {
    streamOps(request: GenerateRequest) {
      return runTurnLoop({
        request,
        idFactory,
        caps: PRODUCTION_CAPS,
        runTurn: attemptTurns(client, model, request),
      });
    },
  };
}
