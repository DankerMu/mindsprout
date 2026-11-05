import { describe, expect, it } from 'vitest';
import { REDACT_PATHS, createLogger, logger } from './logger';

describe('createLogger', () => {
  it('builds a pino logger at the requested level and name', () => {
    const log = createLogger('debug', 'test');

    expect(log.level).toBe('debug');
    expect(log.bindings().name).toBe('test');
  });

  it('redacts configured secret paths', () => {
    expect(REDACT_PATHS).toContain('*.apiKey');
    expect(REDACT_PATHS).toContain('req.headers.authorization');
  });

  it('exposes a default logger at info level', () => {
    expect(logger.level).toBe('info');
  });
});
