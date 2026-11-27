import type { TreeOp } from '../acl/map';
import {
  type ProviderErrorCode,
  ProviderOutputError,
  ProviderRefusedError,
  ProviderTransportError,
} from '../domain/errors';
import type { GenerateRequest, Provider } from './provider';

// Structurally the shared pino logger: one fields object, no message string. 4.1 passes `logger`.
export interface GenerationLog {
  info(fields: object): void;
}

interface GenerateOptions {
  providerId: string;
  model: string;
  log: GenerationLog;
  timeoutMs?: number;
}

// Total limit across both attempts (ai-provider "Generation has a total time limit").
const DEFAULT_TIMEOUT_MS = 30_000;

// Fixed diagnostics: never the provider's message, body, key or the topic (design D5).
const MESSAGES: Record<ProviderErrorCode, string> = {
  timeout: 'The generation exceeded its time limit',
  'provider-error': 'The AI provider request failed',
  'invalid-output': 'The AI provider returned unusable output',
  refused: 'The AI provider refused the topic',
};

// The only error `generate` throws. Deliberately carries no `cause`: the provider error may hold
// a response body or a key.
export class GenerationError extends Error {
  override readonly name = 'GenerationError';
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

type Outcome = 'done' | 'aborted' | ProviderErrorCode;

interface Tally {
  attempts: number;
  // Ops of the attempt that counts: a retry happens only after an attempt yielded none.
  ops: number;
  outcome: Outcome;
}

// One controller per generation, aborted by the caller's signal or by the timer (started once,
// so the limit spans both attempts). `release` undoes both links and cancels the provider.
interface AbortLink {
  signal: AbortSignal;
  timedOut: () => boolean;
  release: () => void;
}

function linkAbort(caller: AbortSignal, timeoutMs: number): AbortLink {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => {
    controller.abort(caller.reason);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException(MESSAGES.timeout, 'TimeoutError'));
  }, timeoutMs);
  caller.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    release: () => {
      clearTimeout(timer);
      caller.removeEventListener('abort', onAbort);
      controller.abort();
    },
  };
}

function codeOf(error: unknown): ProviderErrorCode {
  const known =
    error instanceof ProviderTransportError ||
    error instanceof ProviderOutputError ||
    error instanceof ProviderRefusedError;
  return known ? error.code : 'provider-error';
}

// Classification order of design D5; the state decides abort and timeout, never the error type.
function classify(
  error: unknown,
  tally: Tally,
  caller: AbortSignal,
  link: AbortLink,
): 'aborted' | 'retry' | ProviderErrorCode {
  if (caller.aborted) return 'aborted';
  if (link.timedOut()) return 'timeout';
  const retryable = error instanceof ProviderTransportError || error instanceof ProviderOutputError;
  if (retryable && tally.ops === 0 && tally.attempts === 1) return 'retry';
  return codeOf(error);
}

async function* runAttempts(
  provider: Provider,
  request: GenerateRequest,
  link: AbortLink,
  tally: Tally,
): AsyncGenerator<TreeOp, void, undefined> {
  for (;;) {
    tally.attempts += 1;
    try {
      for await (const op of provider.streamOps({ ...request, signal: link.signal })) {
        tally.ops += 1;
        yield op;
      }
      tally.outcome = 'done';
      return;
    } catch (error) {
      const verdict = classify(error, tally, request.signal, link);
      if (verdict === 'retry') continue;
      tally.outcome = verdict;
      if (verdict === 'aborted') return;
      throw new GenerationError(verdict);
    }
  }
}

// Wraps provider attempts with the D5 retry rule, the total time limit, the caller's abort and
// one `ai.generate` log entry per exit. Returns normally on success and on client abort (the
// caller tells them apart by `request.signal.aborted`); throws GenerationError otherwise.
// Port precondition: a provider rejects promptly once its signal aborts, so no timer race here.
export async function* generate(
  provider: Provider,
  request: GenerateRequest,
  options: GenerateOptions,
): AsyncGenerator<TreeOp, void, undefined> {
  const startedAt = Date.now();
  // Stays `aborted` for a pre-aborted request and for a consumer return() mid-stream.
  const tally: Tally = { attempts: 0, ops: 0, outcome: 'aborted' };
  // A listener added to an already aborted signal never fires, so such a call never starts.
  const link = request.signal.aborted
    ? undefined
    : linkAbort(request.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    if (link !== undefined) yield* runAttempts(provider, request, link, tally);
  } finally {
    link?.release();
    options.log.info({
      event: 'ai.generate',
      provider: options.providerId,
      model: options.model,
      attempts: tally.attempts,
      ops: tally.ops,
      durationMs: Date.now() - startedAt,
      outcome: tally.outcome,
    });
  }
}
