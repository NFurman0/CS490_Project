import {
  apiErrorResponseSchema,
  type ErrorCode,
  type IngestionErrorCode,
} from '@reviewlens/shared';

/**
 * The single place error codes become user-facing text (Engineering Standards §7).
 * Components show these messages, never raw response text.
 */
const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Please check the highlighted fields.',
  UNAUTHENTICATED: 'Your session has ended. Sign in again to continue.',
  NOT_FOUND: 'We couldn’t find that. It may have been removed, or you may not have access to it.',
  CONFLICT: 'That action is already in progress. Wait for it to finish, then try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
};

export const FALLBACK_MESSAGE = MESSAGES.INTERNAL_ERROR;

export const NETWORK_ERROR_MESSAGE =
  'Can’t reach ReviewLens right now. Check your connection and try again.';

// Run outcomes are separate from HTTP errors: never render provider or database details.
const INGESTION_MESSAGES: Record<IngestionErrorCode, string> = {
  SOURCE_UNRESOLVABLE:
    'The Google Maps place link could not be resolved. Check the link and try again.',
  SOURCE_NO_REVIEWS:
    'No usable reviews were found. Try another Google Maps place or try again later.',
  PROVIDER_TIMEOUT: 'The review source timed out. Please try again later.',
  PROVIDER_QUOTA_EXHAUSTED:
    'The review service’s search limit was reached. Please try again later.',
  PROVIDER_ERROR: 'The review service could not provide results. Please try again later.',
  PERSISTENCE_ERROR: 'The reviews could not be saved. Please try again later.',
};

export function ingestionMessageFor(code: IngestionErrorCode | null): string {
  return code ? INGESTION_MESSAGES[code] : FALLBACK_MESSAGE;
}

/** Turns any API error response body into a safe message for the user. */
export function userMessageFor(responseBody: unknown): string {
  const parsed = apiErrorResponseSchema.safeParse(responseBody);
  return parsed.success ? MESSAGES[parsed.data.error.code] : FALLBACK_MESSAGE;
}
