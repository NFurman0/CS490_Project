import type { IngestionRun } from '@prisma/client';
import { startIngestionRequestSchema, type IngestionRunResponse } from '@reviewlens/shared';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { currentUser } from '../../lib/identity.js';
import type { IngestionService } from './ingestion.service.js';

/** Where this router is mounted under /api. */
export const INGESTION_RUNS_PATH = '/analysis-targets/:targetId/ingestion-runs';

const targetIdSchema = z.uuid();

function targetIdFrom(value: unknown): string {
  const parsed = targetIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'Analysis target not found.');
  return parsed.data;
}

const STATUS_IN_RESPONSE: Record<IngestionRun['status'], IngestionRunResponse['status']> = {
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
};

function toResponse(run: IngestionRun): IngestionRunResponse {
  return {
    id: run.id,
    targetId: run.targetId,
    status: STATUS_IN_RESPONSE[run.status],
    errorCode: run.errorCode,
    reviewCount: run.reviewCount,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  };
}

/** POST /api/analysis-targets/:targetId/ingestion-runs (S1-019). */
export function createIngestionRouter(service: IngestionService) {
  // mergeParams: `:targetId` is part of the mount path, not this router's path.
  const router = Router({ mergeParams: true });

  router.get<{ targetId: string }>('/latest', async (req, res) => {
    const run = await service.latestRun(currentUser(req).id, targetIdFrom(req.params.targetId));
    res.json({ data: run ? toResponse(run) : null });
  });

  router.post<{ targetId: string }>('/', async (req, res) => {
    // Not a UUID can't be a target. Answer like any other unknown target, and keep
    // the malformed value away from the database's UUID column.
    const targetId = targetIdFrom(req.params.targetId);
    startIngestionRequestSchema.parse(req.body ?? {});

    const run = await service.startIngestion(currentUser(req).id, targetId);
    res.status(201).json({ data: toResponse(run) });
  });

  return router;
}
