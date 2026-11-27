import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeOp } from '@/contexts/ai/acl/map';
import type * as MockAdapter from '@/contexts/ai/infrastructure/providers/mock';
import type { Env } from '@/shared/env';

// Collaborators, never the SUT: the vendor factories return opaque sentinels; the mock factory is
// a passthrough spy so the mapping rows and the real pacing row share one file.
const mocks = vi.hoisted(() => ({
  anthropicProvider: { streamOps: () => [] },
  openAIProvider: { streamOps: () => [] },
  createAnthropic: vi.fn(),
  createOpenAI: vi.fn(),
  createMock: vi.fn(),
}));
vi.mock('@/contexts/ai/infrastructure/providers/anthropic', () => ({
  createAnthropicProvider: mocks.createAnthropic,
}));
vi.mock('@/contexts/ai/infrastructure/providers/openai-compatible', () => ({
  createOpenAICompatibleProvider: mocks.createOpenAI,
}));
vi.mock('@/contexts/ai/infrastructure/providers/mock', async (importOriginal) => {
  const actual = await importOriginal<typeof MockAdapter>();
  mocks.createMock.mockImplementation(actual.createMockProvider);
  return { ...actual, createMockProvider: mocks.createMock };
});

// Distinct sentinels, none credential-shaped, so a misrouted value is identifiable.
const ANTHROPIC_KEY = 'fixture-anthropic-key';
const ANTHROPIC_URL = 'https://anthropic-gateway.example.invalid';
const OPENAI_KEY = 'fixture-openai-key';
const OPENAI_URL = 'https://openai-gateway.example.invalid/v1';
const MODEL = 'fixture-model';
const AI_VARIABLES = [
  'AI_PROVIDER',
  'AI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
] as const;

// Every AI variable populated, so each row proves which ones its adapter does not receive.
function fullEnv(provider: string): Record<string, string> {
  return {
    NODE_ENV: 'test',
    AI_PROVIDER: provider,
    AI_MODEL: MODEL,
    ANTHROPIC_API_KEY: ANTHROPIC_KEY,
    ANTHROPIC_BASE_URL: ANTHROPIC_URL,
    OPENAI_API_KEY: OPENAI_KEY,
    OPENAI_BASE_URL: OPENAI_URL,
  };
}

// Dynamic imports isolate the lazy module cache after vi.resetModules(); `logger` comes from the
// same registry so identity is meaningful.
async function load() {
  const { aiService, createAiService } = await import('./ai-services');
  const { logger } = await import('@/shared/logger');
  const { loadEnv } = await import('@/shared/env');
  return { aiService, createAiService, logger, loadEnv };
}

function onlyCall(spy: typeof mocks.createAnthropic): Record<string, unknown> {
  expect(spy).toHaveBeenCalledOnce();
  const [options] = spy.mock.calls[0] as [Record<string, unknown>];
  return options;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.createAnthropic.mockReturnValue(mocks.anthropicProvider);
  mocks.createOpenAI.mockReturnValue(mocks.openAIProvider);
  // Empty means unset (env.ts), so a host shell's real AI variables never reach the SUT.
  for (const name of AI_VARIABLES) vi.stubEnv(name, '');
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('createAiService mapping', () => {
  it('maps anthropic with a base URL to the Claude adapter and the shared logger', async () => {
    const { createAiService, logger, loadEnv } = await load();
    const service = createAiService(loadEnv(fullEnv('anthropic')));
    const options = onlyCall(mocks.createAnthropic);
    expect(Object.keys(options).sort()).toEqual(['apiKey', 'baseURL', 'idFactory', 'model']);
    const { idFactory, ...rest } = options;
    expect(idFactory).toBeTypeOf('function');
    expect(rest).toEqual({ apiKey: ANTHROPIC_KEY, model: MODEL, baseURL: ANTHROPIC_URL });
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
    expect(mocks.createMock).not.toHaveBeenCalled();
    expect(service?.provider).toBe(mocks.anthropicProvider);
    expect(service?.providerId).toBe('anthropic');
    expect(service?.model).toBe(MODEL);
    expect(service?.log).toBe(logger);
  });

  it('omits the baseURL key for anthropic without a base URL, keeping the SDK default host', async () => {
    const { createAiService, loadEnv } = await load();
    const service = createAiService(loadEnv({ ...fullEnv('anthropic'), ANTHROPIC_BASE_URL: '' }));
    const options = onlyCall(mocks.createAnthropic);
    expect(Object.keys(options).sort()).toEqual(['apiKey', 'idFactory', 'model']);
    expect(options).not.toHaveProperty('baseURL');
    expect(options).toMatchObject({ apiKey: ANTHROPIC_KEY, model: MODEL });
    expect(service?.provider).toBe(mocks.anthropicProvider);
  });

  it('maps openai-compatible to its adapter with only its own key, never the Claude key', async () => {
    const { createAiService, logger, loadEnv } = await load();
    const service = createAiService(loadEnv(fullEnv('openai-compatible')));
    const options = onlyCall(mocks.createOpenAI);
    expect(Object.keys(options).sort()).toEqual(['apiKey', 'baseURL', 'idFactory', 'model']);
    const { idFactory, ...rest } = options;
    expect(idFactory).toBeTypeOf('function');
    expect(rest).toEqual({ apiKey: OPENAI_KEY, baseURL: OPENAI_URL, model: MODEL });
    expect(Object.values(options)).not.toContain(ANTHROPIC_KEY);
    expect(Object.values(options)).not.toContain(ANTHROPIC_URL);
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createMock).not.toHaveBeenCalled();
    expect(service).toEqual({
      provider: mocks.openAIProvider,
      providerId: 'openai-compatible',
      model: MODEL,
      log: logger,
    });
    expect(service?.log).toBe(logger);
  });

  it('maps mock to the 150 ms paced mock with the constant mock model', async () => {
    const { createAiService, logger, loadEnv } = await load();
    const service = createAiService(loadEnv(fullEnv('mock')));
    const options = onlyCall(mocks.createMock);
    expect(Object.keys(options).sort()).toEqual(['delayMs', 'idFactory']);
    const { idFactory, ...rest } = options;
    expect(idFactory).toBeTypeOf('function');
    expect(rest).toEqual({ delayMs: 150 });
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
    expect(service?.provider).toBe(mocks.createMock.mock.results[0]?.value);
    expect(service?.providerId).toBe('mock');
    expect(service?.model).toBe('mock');
    expect(service?.log).toBe(logger);
  });

  it('returns undefined for an unset provider without calling any factory', async () => {
    const { createAiService, loadEnv } = await load();
    expect(createAiService(loadEnv({ ...fullEnv(''), AI_PROVIDER: '' }))).toBeUndefined();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
    expect(mocks.createMock).not.toHaveBeenCalled();
  });

  it.each(['anthropic', 'openai-compatible', 'mock'])(
    'gives the %s adapter an idFactory issuing distinct non-empty ids',
    async (provider) => {
      const { createAiService, loadEnv } = await load();
      createAiService(loadEnv(fullEnv(provider)));
      const spies = [mocks.createAnthropic, mocks.createOpenAI, mocks.createMock];
      const spy = spies.find((candidate) => candidate.mock.calls.length > 0);
      const { idFactory } = onlyCall(spy ?? mocks.createAnthropic) as { idFactory: () => string };
      const ids = Array.from({ length: 50 }, () => idFactory());
      expect(new Set(ids).size).toBe(50);
      for (const id of ids) {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    },
  );
});

describe('createAiService narrowing of a hand-built Env', () => {
  const base: Env = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    AI_MODEL: MODEL,
    ANTHROPIC_BASE_URL: ANTHROPIC_URL,
    OPENAI_API_KEY: OPENAI_KEY,
  };

  it('names ANTHROPIC_API_KEY, and no env value, for anthropic without a key', async () => {
    const { createAiService } = await load();
    const env: Env = { ...base, AI_PROVIDER: 'anthropic' };
    expect(() => createAiService(env)).toThrow(Error);
    expect(() => createAiService(env)).toThrow('ANTHROPIC_API_KEY');
    const message = (() => {
      try {
        createAiService(env);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    })();
    for (const value of [MODEL, ANTHROPIC_URL, OPENAI_KEY]) expect(message).not.toContain(value);
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
  });

  it('names OPENAI_BASE_URL, and no env value, for openai-compatible without a base URL', async () => {
    const { createAiService } = await load();
    const env: Env = {
      ...base,
      AI_PROVIDER: 'openai-compatible',
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
    };
    let message = '';
    try {
      createAiService(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('OPENAI_BASE_URL');
    for (const value of [MODEL, ANTHROPIC_URL, ANTHROPIC_KEY, OPENAI_KEY]) {
      expect(message).not.toContain(value);
    }
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });
});

describe('aiService lazy composition', () => {
  it('composes the mock once and returns the same service on later calls', async () => {
    vi.stubEnv('AI_PROVIDER', 'mock');
    const { aiService } = await load();
    expect(mocks.createMock).not.toHaveBeenCalled();
    const first = aiService();
    expect(first?.providerId).toBe('mock');
    expect(aiService()).toBe(first);
    expect(mocks.createMock).toHaveBeenCalledOnce();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it('caches an unset provider as undefined until the module reloads', async () => {
    const { aiService } = await load();
    expect(aiService()).toBeUndefined();
    vi.stubEnv('AI_PROVIDER', 'mock');
    expect(aiService()).toBeUndefined();
    expect(mocks.createMock).not.toHaveBeenCalled();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it('never caches an invalid env, so a fixed env composes on the next call', async () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('AI_MODEL', MODEL);
    const { aiService } = await load();
    expect(() => aiService()).toThrow(/^Invalid environment configuration — ANTHROPIC_API_KEY/);
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    vi.stubEnv('ANTHROPIC_API_KEY', ANTHROPIC_KEY);
    const service = aiService();
    expect(service?.providerId).toBe('anthropic');
    expect(onlyCall(mocks.createAnthropic)).toMatchObject({ apiKey: ANTHROPIC_KEY, model: MODEL });
  });
});

describe('mock pacing through the composition', () => {
  it('settles no op at 149 ms and the first op at 150 ms', async () => {
    vi.useFakeTimers();
    const { createAiService, loadEnv } = await load();
    const service = createAiService(loadEnv(fullEnv('mock')));
    if (!service) throw new Error('expected a mock service');
    const ops: TreeOp[] = [];
    const drained = (async () => {
      const request = {
        topic: 'fixture topic',
        rootId: 'root',
        signal: new AbortController().signal,
      };
      for await (const op of service.provider.streamOps(request)) ops.push(op);
    })();
    await vi.advanceTimersByTimeAsync(149);
    expect(ops).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'add_children', parentId: 'root' });
    await vi.advanceTimersByTimeAsync(150 * 5);
    await drained;
    expect(ops).toHaveLength(5);
  });
});
