import Anthropic, { AnthropicError, APIError, type ClientOptions } from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
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
import {
  ProviderOutputError,
  ProviderRefusedError,
  ProviderTransportError,
} from '../../domain/errors';
import { PRODUCTION_CAPS } from '../../domain/generate-tool';

// The Claude adapter (design D3, D4): one `client.beta.messages.stream` per turn, driven by the
// shared turn loop. Every failure becomes a provider error with a fixed message and no cause
// (proposal "Issue #303 Fixture Triage").

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

const UNFINISHED_INPUT = 'Claude tool input is unfinished or not valid JSON';

// One turn's tool inputs by content index. `json` holds the `partial_json` text of each open
// tool_use block; `inputs` the strict parse of each stopped one. The SDK's `block.input` is never
// read: it is a partial-JSON parse that silently completes truncated input. `unfinished` marks a
// stopped block whose input failed the strict parse; the verdict on it waits for the stop reason,
// because a refusal cuts the block it interrupts.
interface TurnInputs {
  json: Map<number, string>;
  inputs: Map<number, unknown>;
  unfinished: boolean;
}

// D3/D4 turn-end mapping, in order. A refusal wins over an unfinished input: a decline while a
// tool_use block is open returns the refusal directly and cuts that block. An open block left at
// the message end is unfinished too. Claude has no content-filter stop reason.
function turnEnd(reason: BetaStopReason | null, turn: TurnInputs): TurnEnd {
  if (reason === 'refusal') throw new ProviderRefusedError('Claude refused the request');
  if (turn.unfinished || turn.json.size > 0) throw new ProviderOutputError(UNFINISHED_INPUT);
  if (reason === 'tool_use') return 'tool-use';
  if (reason === 'end_turn' || reason === 'stop_sequence' || reason === 'max_tokens') {
    return 'natural';
  }
  throw new ProviderTransportError('Claude turn ended with an unsupported stop reason');
}

function parseStrict(json: string): { input: unknown } | undefined {
  try {
    return { input: JSON.parse(json) as unknown };
  } catch {
    // Swallows the SyntaxError: its message quotes the model output. turnEnd gives the verdict.
    return undefined;
  }
}

function startBlock(index: number, type: string, turn: TurnInputs): void {
  // Only a refusal may end a turn with an unfinished input, and nothing follows it on the stream.
  if (turn.unfinished) throw new ProviderOutputError(UNFINISHED_INPUT);
  if (type === 'tool_use') turn.json.set(index, '');
  // An emitted op cannot be withdrawn, so a fallback hop after one ends the attempt.
  if (type === 'fallback' && turn.inputs.size > 0) {
    throw new ProviderTransportError('Claude fell back after a tool input was yielded');
  }
}

function stopBlock(index: number, turn: TurnInputs): TurnItem | undefined {
  const json = turn.json.get(index);
  if (json === undefined) return undefined;
  turn.json.delete(index);
  const parsed = parseStrict(json);
  if (parsed === undefined) {
    turn.unfinished = true;
    return undefined;
  }
  turn.inputs.set(index, parsed.input);
  return { type: 'tool-input', input: parsed.input };
}

// Returns the tool input completed by `event`, if any.
function acceptEvent(event: BetaRawMessageStreamEvent, turn: TurnInputs): TurnItem | undefined {
  if (event.type === 'content_block_start') {
    startBlock(event.index, event.content_block.type, turn);
  } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
    const json = turn.json.get(event.index);
    if (json !== undefined) turn.json.set(event.index, json + event.delta.partial_json);
  } else if (event.type === 'content_block_stop') {
    return stopBlock(event.index, turn);
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
// already rejected, so every acked call follows the last fallback; an unfinished turn has
// rejected too, so every replayed input passed the strict parse.
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

// The SDK's own error for tool input its partial parser rejects at block stop
// (BetaMessageStream `#toolInputParseError`, SDK pinned at 1.13.0). Its message quotes the raw
// model JSON, so only this prefix is read.
const SDK_INPUT_PARSE_ERROR = 'Unable to parse tool parameter JSON from model';

// SDK messages quote response bodies, request ids and model output, so no SDK error is forwarded
// or kept as a cause. Every APIError (HTTP status, connection, user abort) is a transport error;
// the turn loop turns an abort into signal.reason.
function classified(error: unknown): Error {
  if (
    error instanceof ProviderOutputError ||
    error instanceof ProviderTransportError ||
    error instanceof ProviderRefusedError
  ) {
    return error;
  }
  if (
    error instanceof AnthropicError &&
    !(error instanceof APIError) &&
    error.message.startsWith(SDK_INPUT_PARSE_ERROR)
  ) {
    return new ProviderOutputError('Claude tool input is not valid JSON');
  }
  return new ProviderTransportError('Claude request failed');
}

interface TurnOutcome {
  end: TurnEnd;
  content: BetaContentBlock[];
}

// Streams one request. The stream is iterated as soon as it is created, so the SDK always has an
// error listener; a consumer stop at a yield closes the iterator, which aborts the request. The
// final message rethrows errors the event iterator swallows, and its stop reason gives the turn
// verdict. Every error aborts the request first: an error the SDK reports itself (such as
// malformed tool input at block stop) rejects the iterator without closing it, and the body would
// keep streaming.
async function* streamTurn(
  client: Anthropic,
  body: BetaMessageStreamParams,
  signal: AbortSignal,
  turn: TurnInputs,
): AsyncGenerator<TurnItem, TurnOutcome, undefined> {
  const stream = client.beta.messages.stream(body, { signal });
  try {
    for await (const event of stream) {
      const item = acceptEvent(event, turn);
      if (item !== undefined) yield item;
    }
    const message = await stream.finalMessage();
    return { end: turnEnd(message.stop_reason, turn), content: message.content };
  } catch (error) {
    stream.abort();
    throw classified(error);
  }
}

// One attempt's `runTurn`: the history starts from the topic alone and grows by the assistant
// turn and its acks after every tool_use turn.
function attemptTurns(client: Anthropic, model: string, request: GenerateRequest) {
  const prompt = buildGenerateRequest(request.topic);
  const history: BetaMessageParam[] = [...prompt.messages];
  return async function* runTurn(): AsyncGenerator<TurnItem, TurnEnd, undefined> {
    const turn: TurnInputs = { json: new Map(), inputs: new Map(), unfinished: false };
    const body = requestBody(model, prompt.system, history);
    const { end, content } = yield* streamTurn(client, body, request.signal, turn);
    if (end === 'tool-use') history.push(...acknowledged(content, turn));
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
