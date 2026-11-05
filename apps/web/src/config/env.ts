import { z } from 'zod';

const webEnvSchema = z.object({
  VITE_API_BASE_URL: z.url(),
  VITE_CLERK_PUBLISHABLE_KEY: z
    .string()
    .startsWith('pk_', 'must be a Clerk publishable key (starts with pk_)')
    .refine((v) => !v.includes('replace_me'), 'is still the .env.example placeholder'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export type WebEnvResult = { ok: true; env: WebEnv } | { ok: false; problems: string[] };

/** Validates browser configuration. Problems name variables, never values. */
export function parseWebEnv(source: Record<string, unknown>): WebEnvResult {
  const result = webEnvSchema.safeParse(source);
  if (result.success) return { ok: true, env: result.data };

  return {
    ok: false,
    problems: result.error.issues.map((issue) => {
      const name = issue.path.join('.');
      const value = source[name];
      return value === undefined || value === ''
        ? `${name} is missing`
        : `${name} ${issue.message}`;
    }),
  };
}
