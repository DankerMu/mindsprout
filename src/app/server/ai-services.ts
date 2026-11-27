import { nanoid } from 'nanoid';
import type { GenerationLog } from '@/contexts/ai/application/generate';
import type { Provider } from '@/contexts/ai/application/provider';
import { createAnthropicProvider } from '@/contexts/ai/infrastructure/providers/anthropic';
import { createMockProvider } from '@/contexts/ai/infrastructure/providers/mock';
import { createOpenAICompatibleProvider } from '@/contexts/ai/infrastructure/providers/openai-compatible';
import { type Env, loadEnv } from '@/shared/env';
import { logger } from '@/shared/logger';

// The AI composition root (design D1): env → one provider or `undefined`. The only module that
// imports adapters; `providerId`, `model` and `log` are exactly what `generate` takes.
export interface AiService {
  provider: Provider;
  providerId: NonNullable<Env['AI_PROVIDER']>;
  model: string;
  log: GenerationLog;
}

// Per-op mock pacing (design D11): slow enough for the progressive-appearance e2e to observe.
const MOCK_DELAY_MS = 150;

// The editor's node-id generator, so server ids look like client ids.
const idFactory = () => nanoid();

// `loadEnv` already guarantees these for the selected provider; the `Env` type cannot express it.
// Only a hand-built `Env` reaches the throw, and the message names the variable, never a value.
function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required for the configured AI provider`);
  return value;
}

function anthropicService(env: Env): AiService {
  const model = required(env.AI_MODEL, 'AI_MODEL');
  const provider = createAnthropicProvider({
    apiKey: required(env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY'),
    model,
    idFactory,
    // Unset means the SDK default host; `exactOptionalPropertyTypes` forbids passing `undefined`.
    ...(env.ANTHROPIC_BASE_URL === undefined ? {} : { baseURL: env.ANTHROPIC_BASE_URL }),
  });
  return { provider, providerId: 'anthropic', model, log: logger };
}

function openAICompatibleService(env: Env): AiService {
  const model = required(env.AI_MODEL, 'AI_MODEL');
  const provider = createOpenAICompatibleProvider({
    apiKey: required(env.OPENAI_API_KEY, 'OPENAI_API_KEY'),
    baseURL: required(env.OPENAI_BASE_URL, 'OPENAI_BASE_URL'),
    model,
    idFactory,
  });
  return { provider, providerId: 'openai-compatible', model, log: logger };
}

// No vendor model is called, so `model` is a constant even when the owner's `.env` sets AI_MODEL.
function mockService(): AiService {
  const provider = createMockProvider({ idFactory, delayMs: MOCK_DELAY_MS });
  return { provider, providerId: 'mock', model: 'mock', log: logger };
}

export function createAiService(env: Env): AiService | undefined {
  switch (env.AI_PROVIDER) {
    case undefined:
      return undefined;
    case 'anthropic':
      return anthropicService(env);
    case 'openai-compatible':
      return openAICompatibleService(env);
    case 'mock':
      return mockService();
  }
}

// Boxed so an unset provider (`undefined`) is cached too. A throw is never cached, the same as
// `accountResources()`, so a fixed env composes on the next call.
let cached: { service: AiService | undefined } | undefined;

export function aiService(): AiService | undefined {
  if (cached) return cached.service;
  const service = createAiService(loadEnv(process.env));
  cached = { service };
  return service;
}
