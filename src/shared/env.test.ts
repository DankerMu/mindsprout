import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const AI_KEYS = [
  'AI_PROVIDER',
  'AI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
] as const;

const OPENAI_COMPATIBLE = {
  AI_PROVIDER: 'openai-compatible',
  OPENAI_API_KEY: 'sk-test-openai-key',
  OPENAI_BASE_URL: 'https://api.openai.com/v1',
  AI_MODEL: 'test-model',
};

const ANTHROPIC = {
  AI_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'sk-test-anthropic-key',
  AI_MODEL: 'test-model',
};

function loadError(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected loadEnv to throw');
}

function without(source: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

describe('loadEnv', () => {
  it('applies defaults when optional values are absent', () => {
    const env = loadEnv({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('accepts a valid database url and explicit log level', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://app:app@localhost:5432/app_dev',
      LOG_LEVEL: 'debug',
    });

    expect(env.DATABASE_URL).toBe('postgres://app:app@localhost:5432/app_dev');
    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('fails loud on an unexpected value instead of defaulting', () => {
    expect(() => loadEnv({ LOG_LEVEL: 'loud' })).toThrow(/Invalid environment configuration/);
    expect(() => loadEnv({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });
});

describe('AI not configured', () => {
  it('loads an environment without AI variables', () => {
    expect(loadEnv({}).AI_PROVIDER).toBeUndefined();
  });

  it('treats an empty AI_PROVIDER as unset', () => {
    expect(loadEnv({ AI_PROVIDER: '' }).AI_PROVIDER).toBeUndefined();
  });

  it('treats every empty AI variable as unset', () => {
    const env = loadEnv(Object.fromEntries(AI_KEYS.map((key) => [key, ''])));

    for (const key of AI_KEYS) expect(env[key]).toBeUndefined();
  });
});

describe('Example environment loads', () => {
  const example = parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'));

  it('declares every AI variable empty and drops OLLAMA_BASE_URL', () => {
    for (const key of AI_KEYS) expect(example[key]).toBe('');
    expect(example).not.toHaveProperty('OLLAMA_BASE_URL');
  });

  it('loads a verbatim copy with AI unconfigured', () => {
    expect(loadEnv(example).AI_PROVIDER).toBeUndefined();
  });

  it('fails naming the key when only AI_PROVIDER=anthropic is filled in', () => {
    expect(() => loadEnv({ ...example, AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('Partially configured provider fails at load', () => {
  const required = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_MODEL'];

  it.each(required)('openai-compatible names a missing %s', (key) => {
    expect(loadError(without(OPENAI_COMPATIBLE, key))).toContain(`${key}: required`);
  });

  it.each(required)('openai-compatible names an empty %s', (key) => {
    expect(loadError({ ...OPENAI_COMPATIBLE, [key]: '' })).toContain(`${key}: required`);
  });

  it('openai-compatible names every missing variable together', () => {
    const message = loadError({ AI_PROVIDER: 'openai-compatible' });

    for (const key of required) expect(message).toContain(`${key}: required`);
  });

  it.each(['ANTHROPIC_API_KEY', 'AI_MODEL'])('anthropic names a missing %s', (key) => {
    expect(loadError(without(ANTHROPIC, key))).toContain(`${key}: required`);
  });

  it('loads a full openai-compatible configuration without Anthropic variables', () => {
    const env = loadEnv(OPENAI_COMPATIBLE);

    expect(env.AI_PROVIDER).toBe('openai-compatible');
    expect(env.OPENAI_API_KEY).toBe('sk-test-openai-key');
    expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(env.AI_MODEL).toBe('test-model');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('loads a legacy .env copied from the previous example', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgres://mindsprout_app:app@localhost:5432/app_dev',
      MIGRATION_DATABASE_URL: 'postgres://app:app@localhost:5432/app_dev',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OLLAMA_BASE_URL: 'http://localhost:11434/v1',
      PROVIDER_KEY_ENCRYPTION_SECRET: '',
    });

    expect(env.AI_PROVIDER).toBeUndefined();
  });

  it('rejects a base url without an http(s) scheme', () => {
    expect(loadError({ OPENAI_BASE_URL: 'localhost:11434/v1' })).toContain('OPENAI_BASE_URL');
  });
});

describe('Claude provider configuration', () => {
  it('loads with a key and a model, leaving the base url unset', () => {
    const env = loadEnv(ANTHROPIC);

    expect(env.AI_PROVIDER).toBe('anthropic');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-anthropic-key');
    expect(env.AI_MODEL).toBe('test-model');
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('treats an empty base url as unset', () => {
    expect(loadEnv({ ...ANTHROPIC, ANTHROPIC_BASE_URL: '' }).ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('keeps a set base url', () => {
    const env = loadEnv({ ...ANTHROPIC, ANTHROPIC_BASE_URL: 'https://www.dmxapi.cn' });

    expect(env.ANTHROPIC_BASE_URL).toBe('https://www.dmxapi.cn');
  });
});

describe('Mock refused in production', () => {
  it('throws naming AI_PROVIDER in production', () => {
    expect(loadError({ AI_PROVIDER: 'mock', NODE_ENV: 'production' })).toContain('AI_PROVIDER');
  });

  it('loads in development', () => {
    expect(loadEnv({ AI_PROVIDER: 'mock', NODE_ENV: 'development' }).AI_PROVIDER).toBe('mock');
  });
});

describe('load errors never echo input values', () => {
  it('omits an invalid AI_PROVIDER value', () => {
    const message = loadError({ AI_PROVIDER: 'leaky-provider-value' });

    expect(message).toContain('AI_PROVIDER');
    expect(message).not.toContain('leaky-provider-value');
  });

  it('omits an invalid base url', () => {
    const message = loadError({ ANTHROPIC_BASE_URL: 'leaky-host.example:8080/v1' });

    expect(message).toContain('ANTHROPIC_BASE_URL');
    expect(message).not.toContain('leaky-host.example');
  });

  it('omits the key when the model is missing', () => {
    const message = loadError({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-leaky-secret' });

    expect(message).toContain('AI_MODEL');
    expect(message).not.toContain('sk-leaky-secret');
  });
});
