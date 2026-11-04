import { z } from 'zod';

const placeholder = /replace_me/;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection URL'),
  CLERK_SECRET_KEY: z
    .string()
    .startsWith('sk_', 'must be a Clerk secret key (starts with sk_)')
    .refine((v) => !placeholder.test(v), 'is still the .env.example placeholder'),
  CLERK_PUBLISHABLE_KEY: z
    .string()
    .startsWith('pk_', 'must be a Clerk publishable key (starts with pk_)')
    .refine((v) => !placeholder.test(v), 'is still the .env.example placeholder'),
  SERPAPI_API_KEY: z
    .string()
    .min(1)
    .refine((v) => !placeholder.test(v), 'is still the .env.example placeholder'),
  MAX_REVIEWS_PER_RUN: z.coerce.number().int().min(1).max(500).default(50),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/** Thrown when configuration is missing or invalid. Messages name variables, never values. */
export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      [
        'ReviewLens API configuration is invalid:',
        ...problems.map((p) => `  - ${p}`),
        'Copy apps/api/.env.example to apps/api/.env and fill in these values.',
      ].join('\n'),
    );
    this.name = 'ConfigError';
  }
}

/** Validates configuration once at startup. Code reads the returned object, never process.env. */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    const missing = source[name] === undefined || source[name] === '';
    return missing ? `${name} is missing` : `${name} ${issue.message}`;
  });
  throw new ConfigError(problems);
}
