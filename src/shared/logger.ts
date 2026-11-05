import pino from 'pino';
import type { Logger } from 'pino';

// Structured logging (AGENTS.md ## Observability). PII/secret redaction is wired here:
// never log raw user input, tokens, or credentials.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.apiKey',
  '*.api_key',
  '*.password',
  '*.token',
];

export function createLogger(level: string, name = 'mindsprout'): Logger {
  return pino({ name, level, redact: { paths: REDACT_PATHS, censor: '[redacted]' } });
}

export const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
