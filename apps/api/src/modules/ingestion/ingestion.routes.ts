import type { IngestionRun } from '@prisma/client';
import { startIngestionRequestSchema, type IngestionRunResponse } from '@reviewlens/shared';
import { Router } from 'express';
import { currentUser } from '../../lib/identity.js';
import type { IngestionService } from './ingestion.service.js';

/** Where this router is mounted under /api. */
export const INGESTION_RUNS_PATH = '/analysis-targets/:targetId/ingestion-runs';

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

  router.post('/', async (req, res) => {
    const { targetId } = req.params as { targetId?: string };
    startIngestionRequestSchema.parse(req.body ?? {});

    // The service checks ownership (including a malformed ID) before anything else.
    const run = await service.startIngestion(currentUser(req).id, targetId);
    res.status(201).json({ data: toResponse(run) });
  });

  return router;
}
