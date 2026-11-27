import {
  createOpenAICompatible,
  type OpenAICompatibleProviderSettings,
} from '@ai-sdk/openai-compatible';
import {
  jsonSchema,
  streamText,
  type FinishReason,
  type JSONSchema7,
  type LanguageModel,
  type ModelMessage,
  type TextStreamPart,
  type ToolModelMessage,
} from 'ai';
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

// The OpenAI-compatible adapter (design D3, D4): one single-step AI SDK `streamText` call per turn,
// driven by the shared turn loop. The turn's parts are buffered and judged once at the stream end
// (proposal "Issue #301 Fixture Triage"). Every failure becomes a provider error with a fixed
// message and no cause.

interface OpenAICompatibleProviderOptions {
  apiKey: string;
  model: string;
  // Chat-completions origin including its version path, such as `https://www.dmxapi.cn/v1`.
  baseURL: string;
  idFactory: () => NodeId;
  // Transport under the real SDK: tests inject SSE fixtures; composition leaves it unset.
  fetch?: NonNullable<OpenAICompatibleProviderSettings['fetch']>;
}

const MAX_OUTPUT_TOKENS_PER_TURN = 8000;

// The shared schema (D6), with its two readonly `required` arrays copied because JSONSchema7
// types them as mutable; every other part is referenced unchanged.
const { inputSchema } = GENERATE_TOOL_DEFINITION;
const { children } = inputSchema.properties;
const GENERATE_TOOL_SCHEMA: JSONSchema7 = {
  ...inputSchema,
  required: [...inputSchema.required],
  properties: {
    ...inputSchema.properties,
    children: { ...children, items: { ...children.items, required: [...children.items.required] } },
  },
};

// No `execute`: the SDK runs nothing and adds no tool result. No `validate`: the assembler's zod
// parse is the only validation. No `strict`: the request carries the schema as is.
const TOOLS = {
  [GENERATE_TOOL_DEFINITION.name]: {
    description: GENERATE_TOOL_DEFINITION.description,
    inputSchema: jsonSchema(GENERATE_TOOL_SCHEMA),
  },
};

type Part = TextStreamPart<typeof TOOLS>;

interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

// One turn's buffered parts. `failed` marks an error or abort part or a throw from iteration;
// `finish` is the `finish` part's reason. It starts as `error`, so a stream that ends without a
// finish part is judged like one whose provider sent no finish_reason.
interface TurnParts {
  calls: ToolCall[];
  invalid: boolean;
  failed: boolean;
  finish: FinishReason;
}

// `tool-error` parts are ignored: one always follows an invalid call, which already decides.
function collect(part: Part, turn: TurnParts): void {
  switch (part.type) {
    case 'tool-call':
      if (part.invalid === true) turn.invalid = true;
      else
        turn.calls.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
      break;
    case 'error':
    case 'abort':
      turn.failed = true;
      break;
    case 'finish':
      turn.finish = part.finishReason;
      break;
    default:
      break;
  }
}

// D3 turn-end mapping. The SDK maps `stop` with a refusal delta to `content-filter`, a missing
// provider finish_reason to `error` and an unknown one to `other`.
const FINISH_VERDICT: Readonly<Record<FinishReason, TurnEnd | 'refused' | 'unsupported'>> = {
  stop: 'natural',
  // An invalid call has already decided the turn, so every input is complete.
  length: 'natural',
  'tool-calls': 'tool-use',
  'content-filter': 'refused',
  error: 'unsupported',
  interrupted: 'unsupported',
  other: 'unsupported',
};

const REQUEST_FAILED = 'OpenAI-compatible request failed';

// The verdict at the stream end, in order: transport failure, refusal (even over an invalid
// call), invalid call, then the turn end. A failure is returned, not thrown, so the turn throws it
// only after leaving the SDK's scope.
function verdict(turn: TurnParts): TurnEnd | Error {
  if (turn.failed) return new ProviderTransportError(REQUEST_FAILED);
  const end = FINISH_VERDICT[turn.finish];
  if (end === 'unsupported') {
    return new ProviderTransportError('OpenAI-compatible turn ended without a supported finish');
  }
  if (end === 'refused') return new ProviderRefusedError('OpenAI-compatible model refused');
  if (turn.invalid) {
    return new ProviderOutputError(
      'OpenAI-compatible tool call is unfinished, malformed or unknown',
    );
  }
  return end;
}

function acknowledged(calls: readonly ToolCall[]): ToolModelMessage {
  return {
    role: 'tool',
    content: calls.map(({ toolCallId, toolName }) => ({
      type: 'tool-result',
      toolCallId,
      toolName,
      output: { type: 'text', value: 'ok' },
    })),
  };
}

function ignoreError(): void {
  // Replaces the SDK default, console.error: its errors carry the topic and response bodies.
  // The adapter reads every error from the stream instead.
}

interface TurnOutcome {
  end: TurnEnd;
  calls: ToolCall[];
}

// Runs one turn to its verdict, then extends the history after a tool-use end with the SDK's
// assistant message (it keeps reasoning parts) and one `ok` result per call. The final step is
// read only after a tool-use verdict, so a failed turn never leaves a result promise unobserved.
async function streamTurn(
  model: LanguageModel,
  instructions: string,
  history: ModelMessage[],
  signal: AbortSignal,
): Promise<TurnOutcome> {
  const turn: TurnParts = { calls: [], invalid: false, failed: false, finish: 'error' };
  let end: TurnEnd | Error;
  try {
    const result = streamText({
      model,
      instructions,
      messages: [...history],
      tools: TOOLS,
      maxOutputTokens: MAX_OUTPUT_TOKENS_PER_TURN,
      // Each SDK retry is another billed request; generate (D5) owns the single retry.
      maxRetries: 0,
      abortSignal: signal,
      onError: ignoreError,
      // The SDK's spans and integrations can carry the topic and model output; D5 defers spans.
      telemetry: { isEnabled: false },
    });
    for await (const part of result.stream) collect(part, turn);
    end = verdict(turn);
    if (end === 'tool-use') {
      const { messages } = (await result.finalStep).response;
      history.push(...messages, acknowledged(turn.calls));
    }
  } catch {
    // Swallows the SDK's error (such as a mid-body read failure): an APICallError carries the
    // request body with the topic and may carry the response body.
    end = new ProviderTransportError(REQUEST_FAILED);
  }
  if (end instanceof Error) throw end;
  return { end, calls: turn.calls };
}

// One attempt's `runTurn`: the history starts from the topic alone. A turn yields its buffered
// inputs only after its verdict, so a failed turn yields no op (D5 can still retry).
function attemptTurns(model: LanguageModel, request: GenerateRequest) {
  const prompt = buildGenerateRequest(request.topic);
  const history: ModelMessage[] = [...prompt.messages];
  return async function* runTurn(): AsyncGenerator<TurnItem, TurnEnd, undefined> {
    const { end, calls } = await streamTurn(model, prompt.system, history, request.signal);
    for (const { input } of calls) yield { type: 'tool-input', input };
    return end;
  };
}

export function createOpenAICompatibleProvider({
  model,
  idFactory,
  ...settings
}: OpenAICompatibleProviderOptions): Provider {
  // `settings` is exactly apiKey, baseURL and the optional fetch. A model object, never a string
  // id: the SDK resolves a string through the AI gateway.
  const chatModel = createOpenAICompatible({ name: 'openai-compatible', ...settings }).chatModel(
    model,
  );
  return {
    streamOps(request: GenerateRequest) {
      return runTurnLoop({
        request,
        idFactory,
        caps: PRODUCTION_CAPS,
        runTurn: attemptTurns(chatModel, request),
      });
    },
  };
}
