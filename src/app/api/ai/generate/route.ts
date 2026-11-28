import { z } from 'zod';
import { requireJson, requireUser } from '@/app/server/account-services';
import { type AiService, aiService } from '@/app/server/ai-services';
import { GenerationError, generate } from '@/contexts/ai/application/generate';
import { logger } from '@/shared/logger';

// The limit counts UTF-16 code units on the raw string, so it is `length`, not zod's `max`
// (which counts code points past the limit). The topic reaches `generate` untrimmed.
const generateBody = z.strictObject({
  topic: z.string().refine((topic) => topic.length <= 200 && topic.trim() !== ''),
  rootId: z.string().min(1),
});

type GenerateBody = z.infer<typeof generateBody>;

const STREAM_HEADERS = { 'content-type': 'text/event-stream', 'cache-control': 'no-store' };

const encoder = new TextEncoder();

function frame(event: 'op' | 'error' | 'done', data: object): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Iteration starts in `start`, not on the first pull: `generate`'s timer starts at the first
// `next()`. Disconnect reaches the provider through `signal` alone (Next aborts it when the
// response closes); `cancel` only stops writes, because `return()` would queue behind `next()`.
function eventStream(
  service: AiService,
  body: GenerateBody,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Both enqueue and close throw on a cancelled stream; nothing is written after a cancel.
      const write = (chunk?: Uint8Array): void => {
        if (cancelled) return;
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      };
      const { provider, providerId, model, log } = service;
      try {
        for await (const op of generate(
          provider,
          { ...body, signal },
          { providerId, model, log },
        )) {
          write(frame('op', op));
        }
        if (!signal.aborted) write(frame('done', {}));
      } catch (error) {
        if (!(error instanceof GenerationError)) throw error;
        write(frame('error', { code: error.code, message: error.message }));
      }
      write();
    },
    cancel() {
      cancelled = true;
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const unsupported = requireJson(request);
    if (unsupported) return unsupported;
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    // Swallows a body that cannot be read or parsed as JSON; `undefined` then fails the schema.
    const body = generateBody.safeParse(await request.json().catch(() => undefined));
    if (!body.success) return Response.json({ error: 'invalid-input' }, { status: 400 });
    const service = aiService();
    if (service === undefined) return Response.json({ error: 'ai-unavailable' }, { status: 503 });
    return new Response(eventStream(service, body.data, request.signal), {
      headers: STREAM_HEADERS,
    });
  } catch {
    logger.error({ event: 'ai.generate.failed' });
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
