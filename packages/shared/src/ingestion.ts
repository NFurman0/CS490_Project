import { z } from 'zod';
import { INGESTION_ERROR_CODES } from './errors.js';

/**
 * Body of POST /api/analysis-targets/:targetId/ingestion-runs (S1-019).
 * The target comes from the URL and the source from the stored target, so the
 * body is empty. `.strict()` rejects anything sent, including ownership fields.
 */
export const startIngestionRequestSchema = z.object({}).strict();

export type StartIngestionRequest = z.infer<typeof startIngestionRequestSchema>;

/** Lifecycle of one ingestion attempt (S1-BR-023). */
export const INGESTION_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;

export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

/**
 * An ingestion run as the API returns it.
 * `errorCode` is always set on a failed run. On a succeeded run it means the
 * result is partial: a later page failed and the reviews collected before it were kept.
 */
export const ingestionRunSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  status: z.enum(INGESTION_RUN_STATUSES),
  errorCode: z.enum(INGESTION_ERROR_CODES).nullable(),
  reviewCount: z.number().int().min(0),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export type IngestionRunResponse = z.infer<typeof ingestionRunSchema>;
