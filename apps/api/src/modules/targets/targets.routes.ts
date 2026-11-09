import type { AnalysisTarget } from '@prisma/client';
import { createAnalysisTargetSchema } from '@reviewlens/shared';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { currentUser } from '../../lib/identity.js';
import type { createTargetsService } from './targets.service.js';

type TargetsService = ReturnType<typeof createTargetsService>;

function toResponse(target: AnalysisTarget) {
  return {
    id: target.id,
    name: target.name,
    platform: 'google_maps' as const,
    sourceUrl: target.sourceUrl,
    createdAt: target.createdAt.toISOString(),
  };
}

function targetIdFrom(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'Analysis target not found.');
  return parsed.data;
}

export function createTargetsRouter(service: TargetsService) {
  const router = Router();

  router.get('/recent', async (req, res) => {
    const targets = await service.listRecent(currentUser(req).id);

    res.json({ data: targets.map(toResponse) });
  });

  router.get('/', async (req, res) => {
    const targets = await service.list(currentUser(req).id);

    res.json({ data: targets.map(toResponse) });
  });

  router.post('/', async (req, res) => {
    const input = createAnalysisTargetSchema.parse(req.body);
    const target = await service.create(currentUser(req).id, input);

    res.status(201).json({ data: toResponse(target) });
  });

  router.get('/:targetId', async (req, res) => {
    const target = await service.getOwned(currentUser(req).id, targetIdFrom(req.params.targetId));
    res.json({ data: toResponse(target) });
  });

  router.delete('/:targetId', async (req, res) => {
    await service.deleteOwned(currentUser(req).id, targetIdFrom(req.params.targetId));
    res.status(204).end();
  });

  return router;
}
