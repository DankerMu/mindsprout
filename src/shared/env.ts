import { z } from 'zod';

// `cp .env.example .env` leaves AI variables as `KEY=`; an empty value means unset, not invalid.
function emptyAsUnset<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

// The protocol check rejects scheme-less typos such as `localhost:11434/v1`, which WHATWG parses
// as scheme `localhost:`.
const baseUrl = z.url({ protocol: /^https?$/ });

const AI_PROVIDERS = ['anthropic', 'openai-compatible', 'mock'] as const;
type AiProvider = (typeof AI_PROVIDERS)[number];
type AiField = 'AI_MODEL' | 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'OPENAI_BASE_URL';

const REQUIRED_BY_PROVIDER: Record<AiProvider, readonly AiField[]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'AI_MODEL'],
  'openai-compatible': ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_MODEL'],
  mock: [],
};

// Deployment-varying tunables are validated config fields (AGENTS.md universal stack rules).
// Misconfiguration fails loud at load: an invalid value throws instead of silently defaulting.
// Issue messages are fixed text or Zod's enum/URL messages, so no input value reaches the error.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    AI_PROVIDER: emptyAsUnset(z.enum(AI_PROVIDERS)),
    AI_MODEL: emptyAsUnset(z.string().min(1)),
    ANTHROPIC_API_KEY: emptyAsUnset(z.string().min(1)),
    ANTHROPIC_BASE_URL: emptyAsUnset(baseUrl),
    OPENAI_API_KEY: emptyAsUnset(z.string().min(1)),
    OPENAI_BASE_URL: emptyAsUnset(baseUrl),
  })
  .superRefine((env, ctx) => {
    const provider = env.AI_PROVIDER;
    if (provider === undefined) return;
    for (const field of REQUIRED_BY_PROVIDER[provider]) {
      if (env[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `required when AI_PROVIDER=${provider}`,
        });
      }
    }
    if (provider === 'mock' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'mock is refused when NODE_ENV=production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  return result.data;
}
