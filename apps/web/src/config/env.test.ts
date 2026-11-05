import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env';

describe('parseWebEnv', () => {
  it('accepts valid public configuration', () => {
    const result = parseWebEnv({
      VITE_API_BASE_URL: 'http://localhost:3000',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_abc123',
    });
    expect(result.ok).toBe(true);
  });

  it('reports each missing variable by name', () => {
    const result = parseWebEnv({});
    expect(result).toEqual({
      ok: false,
      problems: ['VITE_API_BASE_URL is missing', 'VITE_CLERK_PUBLISHABLE_KEY is missing'],
    });
  });

  it('rejects a Clerk secret key, which must never reach the browser', () => {
    const result = parseWebEnv({
      VITE_API_BASE_URL: 'http://localhost:3000',
      VITE_CLERK_PUBLISHABLE_KEY: 'sk_test_abc123',
    });
    expect(result.ok).toBe(false);
  });
});
