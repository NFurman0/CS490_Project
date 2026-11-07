import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger.js';

const { clerkMiddleware, getAuth } = vi.hoisted(() => ({
  clerkMiddleware: vi.fn(() => vi.fn()),
  getAuth: vi.fn(),
}));
vi.mock('@clerk/express', () => ({ clerkMiddleware, getAuth }));

const { createClerkIdentityProvider, stripClerkAuthHeaders } =
  await import('./clerk-identity-provider.js');

const warn = vi.fn();
const config = {
  secretKey: 'sk_test_abc',
  publishableKey: 'pk_test_abc',
  authorizedParties: ['http://localhost:5173'],
  logger: { warn } as unknown as Logger,
};
const signedOut = {
  isAuthenticated: false,
  userId: null,
  debug: () => ({ reason: 'token-invalid', message: 'Invalid JWT Authorized party claim (azp)' }),
};

function requestWith(headers: Record<string, string> = {}): Request {
  return { headers } as Request;
}

describe('createClerkIdentityProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('configures Clerk with the validated keys and only the web app as an authorized party', () => {
    createClerkIdentityProvider(config);
    expect(clerkMiddleware).toHaveBeenCalledWith({
      secretKey: 'sk_test_abc',
      publishableKey: 'pk_test_abc',
      authorizedParties: ['http://localhost:5173'],
    });
  });

  it('runs header stripping after Clerk verifies the request', () => {
    const { middleware } = createClerkIdentityProvider(config);
    expect(middleware).toHaveLength(2);
    expect(middleware[1]).toBe(stripClerkAuthHeaders);
  });

  it('returns the Clerk user ID for a signed-in request', () => {
    getAuth.mockReturnValue({ isAuthenticated: true, userId: 'user_123' });
    expect(createClerkIdentityProvider(config).resolve(requestWith())).toEqual({
      clerkUserId: 'user_123',
    });
  });

  it('returns null for a request without a token, without logging', () => {
    getAuth.mockReturnValue(signedOut);
    expect(createClerkIdentityProvider(config).resolve(requestWith())).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs why a sent token was rejected, without logging the token', () => {
    getAuth.mockReturnValue(signedOut);
    const req = requestWith({ authorization: 'Bearer secret-token-value' });

    expect(createClerkIdentityProvider(config).resolve(req)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      { reason: 'token-invalid', message: 'Invalid JWT Authorized party claim (azp)' },
      'Clerk rejected the session token',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token-value');
  });
});

describe('stripClerkAuthHeaders', () => {
  it('removes every x-clerk-auth-* header and keeps the rest', () => {
    const headers = new Map<string, string>([
      ['x-clerk-auth-status', 'signed-out'],
      ['x-clerk-auth-reason', 'unexpected-error'],
      ['x-clerk-auth-message', 'details'],
      ['access-control-allow-origin', 'http://localhost:5173'],
    ]);
    const res = {
      getHeaderNames: () => [...headers.keys()],
      removeHeader: (name: string) => headers.delete(name),
    } as unknown as Response;
    const next = vi.fn();

    stripClerkAuthHeaders({} as Request, res, next);

    expect([...headers.keys()]).toEqual(['access-control-allow-origin']);
    expect(next).toHaveBeenCalledOnce();
  });
});
