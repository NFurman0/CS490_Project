import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(fetchImpl: typeof fetch, token: string | null = 'token-123') {
  return createApiClient({
    baseUrl: 'http://localhost:3000',
    getToken: async () => token,
    fetchImpl,
  });
}

async function captureApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError');
}

describe('createApiClient', () => {
  it('sends the session token as a Bearer header and returns the response data', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, { data: { authenticated: true } }),
    );

    const data = await clientWith(fetchImpl).get('/api/session');

    expect(data).toEqual({ authenticated: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('http://localhost:3000/api/session');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-123');
  });

  it('sends no Authorization header when signed out', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, { data: {} }));

    await clientWith(fetchImpl, null).get('/api/session');

    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).has('Authorization')).toBe(false);
  });

  it('posts JSON with the current session token and returns the created resource', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(201, { data: { id: 'target-1' } }),
    );

    await expect(
      clientWith(fetchImpl).post('/api/analysis-targets', { name: 'Place' }),
    ).resolves.toEqual({ id: 'target-1' });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('http://localhost:3000/api/analysis-targets');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-123');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ name: 'Place' }));
  });

  it('preserves structured field errors for validation feedback', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Please check the highlighted fields.',
          details: { fieldErrors: { sourceUrl: ['Enter a Google Maps place or share link.'] } },
        },
      }),
    );

    const error = await captureApiError(clientWith(fetchImpl).post('/api/analysis-targets', {}));

    expect(error.details).toEqual({
      fieldErrors: { sourceUrl: ['Enter a Google Maps place or share link.'] },
    });
  });

  it('turns an error envelope into a user-safe message and keeps the code', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'jwt expired' } }),
    );

    const error = await captureApiError(clientWith(fetchImpl).get('/api/session'));

    expect(error.status).toBe(401);
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.message).toBe('Your session has ended. Sign in again to continue.');
    expect(error.message).not.toContain('jwt');
  });

  it('reports an unreachable API without exposing the network error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch: ECONNREFUSED 127.0.0.1:3000');
    });

    const error = await captureApiError(clientWith(fetchImpl).get('/api/session'));

    expect(error.status).toBe(0);
    expect(error.message).toBe(
      'Can’t reach ReviewLens right now. Check your connection and try again.',
    );
  });

  it('falls back to a generic message for a non-JSON error page', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    );

    const error = await captureApiError(clientWith(fetchImpl).get('/api/session'));

    expect(error.message).toBe('Something went wrong on our side. Please try again.');
  });
});
