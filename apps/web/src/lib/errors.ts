import { apiErrorResponseSchema, type ErrorCode } from '@reviewlens/shared';

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

/** Turns any API error response body into a safe message for the user. */
export function userMessageFor(responseBody: unknown): string {
  const parsed = apiErrorResponseSchema.safeParse(responseBody);
  return parsed.success ? MESSAGES[parsed.data.error.code] : FALLBACK_MESSAGE;
}
