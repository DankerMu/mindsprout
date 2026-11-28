import { z } from 'zod';
import { SESSION_BINDING_HEADER } from '@/shared/session-binding';
import { GenerateError, type GenerateErrorCode } from '../../domain/errors';
import type { GenerateInput, GenerateSource } from '../../domain/generate-source';
import { parseTreeOp, type TreeOp } from '../../domain/tree-op';

type BodyReader = ReadableStreamDefaultReader<Uint8Array>;

const GENERATE_PATH = '/api/ai/generate';
const FRAME_END = '\n\n';
// Exactly the two lines `frame()` in the route writes. `[^\n]`, not `.`: JSON.stringify leaves
// U+2028 and U+2029 raw, and `.` stops at them.
const FRAME = /^event: ([^\n]*)\ndata: ([^\n]*)$/;
// `z.object` drops every other key, so the server's diagnostic `message` is never read.
const errorFrameSchema = z.object({
  code: z.enum(['timeout', 'provider-error', 'invalid-output', 'refused']),
});

function responseReader(response: Response): BodyReader {
  if (response.status === 401) throw new GenerateError('unauthenticated');
  if (response.status === 503) throw new GenerateError('ai-unavailable');
  if (response.status !== 200 || response.body === null) throw new GenerateError('provider-error');
  return response.body.getReader();
}

// Returns undefined when the read ended because `signal` aborted.
async function readChunk(reader: BodyReader, signal: AbortSignal): Promise<Uint8Array | undefined> {
  let result: ReadableStreamReadResult<Uint8Array>;
  try {
    result = await reader.read();
  } catch {
    if (signal.aborted) return undefined;
    throw new GenerateError('network');
  }
  if (!result.done || signal.aborted) return result.value;
  throw new GenerateError('provider-error');
}

function opOf(data: string): TreeOp {
  try {
    return parseTreeOp(JSON.parse(data));
  } catch {
    // JSON.parse throws SyntaxError and parseTreeOp throws TreeOpError: unusable content.
    throw new GenerateError('invalid-output');
  }
}

function errorFrameCode(data: string): GenerateErrorCode {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return 'provider-error';
  }
  const frame = errorFrameSchema.safeParse(payload);
  return frame.success ? frame.data.code : 'provider-error';
}

// Returns the frame's op, or undefined for `done`; throws for `error` and any malformed frame.
function frameOp(frame: string): TreeOp | undefined {
  const [, event, data = ''] = FRAME.exec(frame) ?? [];
  if (event === 'op') return opOf(data);
  if (event === 'error') throw new GenerateError(errorFrameCode(data));
  if (event === 'done' && data === '{}') return undefined;
  throw new GenerateError('provider-error');
}

async function* readOps(reader: BodyReader, signal: AbortSignal): AsyncGenerator<TreeOp, void> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    const chunk = await readChunk(reader, signal);
    if (chunk === undefined) return;
    buffer += decoder.decode(chunk, { stream: true });
    for (let end = buffer.indexOf(FRAME_END); end >= 0; end = buffer.indexOf(FRAME_END)) {
      // Checked before every frame, including on resuming from `yield`: a Stop drops the
      // frames already buffered.
      if (signal.aborted) return;
      const op = frameOp(buffer.slice(0, end));
      if (op === undefined) return;
      buffer = buffer.slice(end + FRAME_END.length);
      yield op;
    }
  }
}

export class HttpGenerateSource implements GenerateSource {
  constructor(
    private readonly fetchGenerate: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly binding?: string,
  ) {}

  async *generate(input: GenerateInput, signal: AbortSignal): AsyncGenerator<TreeOp, void> {
    // An already-aborted signal never fetches.
    const response = signal.aborted ? undefined : await this.request(input, signal);
    // Abort wins over any status, even from a fetch that ignores the signal. The listener is
    // added in this same synchronous run, so no abort falls between the check and it.
    if (response === undefined || signal.aborted) return;
    const reader = responseReader(response);
    const cancel = (): void => {
      // Swallows the stored error `cancel()` rejects with on an already-errored stream.
      reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel);
    try {
      yield* readOps(reader, signal);
    } finally {
      signal.removeEventListener('abort', cancel);
      // Swallows the stored error `cancel()` rejects with on an errored stream (after a read
      // rejection), so it never replaces the generator's own outcome.
      reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  // Returns undefined when the fetch rejected because `signal` aborted.
  private async request(input: GenerateInput, signal: AbortSignal): Promise<Response | undefined> {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (this.binding !== undefined) headers.set(SESSION_BINDING_HEADER, this.binding);
    const body = JSON.stringify({ topic: input.topic, rootId: input.rootId });
    try {
      return await this.fetchGenerate(GENERATE_PATH, { method: 'POST', headers, body, signal });
    } catch {
      if (signal.aborted) return undefined;
      throw new GenerateError('network');
    }
  }
}
