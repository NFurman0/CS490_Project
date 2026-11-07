import { apiErrorResponseSchema, type ErrorCode } from '@reviewlens/shared';
import { FALLBACK_MESSAGE, NETWORK_ERROR_MESSAGE, userMessageFor } from './errors';

/** A failed API call. `message` is always safe to show to the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current Clerk session token, or null when signed out. */
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

/**
 * The only way the web app calls the API. Attaches the session token so feature
 * code never builds auth headers itself (docs/security-guardrails.md §1.1).
 */
export function createApiClient({
  baseUrl,
  getToken,
  fetchImpl = (input, init) => fetch(input, init),
}: ApiClientOptions): ApiClient {
  async function request<T>(path: string): Promise<T> {
    const token = await getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetchImpl(new URL(path, baseUrl), { headers });
    } catch (error) {
      throw new ApiError(0, NETWORK_ERROR_MESSAGE, undefined, { cause: error });
    }

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const parsed = apiErrorResponseSchema.safeParse(body);
      throw new ApiError(
        response.status,
        userMessageFor(body),
        parsed.success ? parsed.data.error.code : undefined,
      );
    }
    if (body && typeof body === 'object' && 'data' in body) return body.data as T;
    throw new ApiError(response.status, FALLBACK_MESSAGE);
  }

  return { get: request };
}
