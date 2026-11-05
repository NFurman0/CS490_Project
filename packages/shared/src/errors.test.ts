import { describe, expect, it } from 'vitest';
import { apiErrorResponseSchema } from './errors.js';

describe('apiErrorResponseSchema', () => {
  it('accepts a well-formed error envelope', () => {
    const result = apiErrorResponseSchema.safeParse({
      error: { code: 'NOT_FOUND', message: 'Analysis target not found.', requestId: 'abc' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an envelope with an unknown error code', () => {
    const result = apiErrorResponseSchema.safeParse({
      error: { code: 'SOMETHING_ELSE', message: 'x' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a response that is not an error envelope', () => {
    expect(apiErrorResponseSchema.safeParse({ data: { id: '1' } }).success).toBe(false);
  });
});
