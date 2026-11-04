import { describe, expect, it } from 'vitest';
import { userMessageFor } from './errors';

describe('userMessageFor', () => {
  it('maps a known error code to its user message', () => {
    const body = { error: { code: 'UNAUTHENTICATED', message: 'jwt expired' } };
    expect(userMessageFor(body)).toBe('Your session has ended. Sign in again to continue.');
  });

  it('never shows the raw server message', () => {
    const body = {
      error: { code: 'INTERNAL_ERROR', message: 'PrismaClientKnownRequestError P2002' },
    };
    expect(userMessageFor(body)).not.toContain('Prisma');
  });

  it('falls back to a generic message for unrecognized responses', () => {
    expect(userMessageFor('<html>502 Bad Gateway</html>')).toBe(
      'Something went wrong on our side. Please try again.',
    );
  });
});
