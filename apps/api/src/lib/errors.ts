import type { ErrorCode } from '@reviewlens/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

/**
 * An expected failure with a user-safe message (Engineering Standards §7).
 * `message` is shown to end users, so it must never contain internal details.
 */
export class AppError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.httpStatus = STATUS_BY_CODE[code];
  }
}
