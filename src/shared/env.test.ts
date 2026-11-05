import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

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
