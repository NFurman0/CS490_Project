import { z } from 'zod';

/** Request-level error codes (Engineering Standards §6.3). */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Ingestion run outcome codes (Engineering Standards §6.4). */
export const INGESTION_ERROR_CODES = [
  'SOURCE_UNRESOLVABLE',
  'SOURCE_NO_REVIEWS',
  'PROVIDER_TIMEOUT',
  'PROVIDER_QUOTA_EXHAUSTED',
  'PROVIDER_ERROR',
  // A saved run needs its own code if the DB fails after the source succeeds.
  'PERSISTENCE_ERROR',
] as const;

export type IngestionErrorCode = (typeof INGESTION_ERROR_CODES)[number];

/** The error envelope every API error response uses (Engineering Standards §6.2). */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
