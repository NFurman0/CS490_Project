import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv } from './env.js';

const publishableKey = `pk_test_${btoa('example.clerk.accounts.dev$')}`;

const validEnv = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://reviewlens:reviewlens@localhost:5432/reviewlens',
  CLERK_SECRET_KEY: 'sk_test_abc123',
  CLERK_PUBLISHABLE_KEY: publishableKey,
  SERPAPI_API_KEY: 'serp-key-123',
};

function captureConfigError(source: Record<string, string | undefined>): ConfigError {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadEnv to throw a ConfigError');
}

describe('loadEnv', () => {
  it('accepts valid configuration and applies defaults', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.MAX_REVIEWS_PER_RUN).toBe(50);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('names every missing required variable', () => {
    const error = captureConfigError({ WEB_ORIGIN: 'http://localhost:5173' });
    expect(error.message).toContain('DATABASE_URL is missing');
    expect(error.message).toContain('CLERK_SECRET_KEY is missing');
    expect(error.message).toContain('SERPAPI_API_KEY is missing');
  });

  it('rejects the .env.example placeholder values', () => {
    const error = captureConfigError({ ...validEnv, CLERK_SECRET_KEY: 'sk_test_replace_me' });
    expect(error.message).toContain('CLERK_SECRET_KEY is still the .env.example placeholder');
  });

  it('rejects a publishable key in the secret key slot', () => {
    const error = captureConfigError({ ...validEnv, CLERK_SECRET_KEY: 'pk_test_abc123' });
    expect(error.message).toContain('CLERK_SECRET_KEY must be a Clerk secret key');
  });

  it('rejects a made-up publishable key at startup', () => {
    const error = captureConfigError({ ...validEnv, CLERK_PUBLISHABLE_KEY: 'pk_test_local123' });
    expect(error.message).toContain('CLERK_PUBLISHABLE_KEY is not a valid Clerk publishable key');
  });

  it('rejects a secret key copied from the dashboard in its shortened form', () => {
    const error = captureConfigError({ ...validEnv, CLERK_SECRET_KEY: 'sk_test_a…xyz' });
    expect(error.message).toContain('CLERK_SECRET_KEY is not a complete Clerk secret key');
  });

  it('never includes secret values in the error message', () => {
    const error = captureConfigError({ ...validEnv, CLERK_SECRET_KEY: 'pk_live_super_secret' });
    expect(error.message).not.toContain('pk_live_super_secret');
  });
});
