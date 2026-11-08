import { createAnalysisTargetSchema } from '@reviewlens/shared';
import { Router } from 'express';
import { currentUser } from '../../lib/identity.js';
import type { createTargetsService } from './targets.service.js';

type TargetsService = ReturnType<typeof createTargetsService>;

export function createTargetsRouter(service: TargetsService) {
  const router = Router();

  router.get('/recent', async (req, res) => {
    const targets = await service.listRecent(currentUser(req).id);

    res.json({
      data: targets.map((target) => ({
        id: target.id,
        name: target.name,
        platform: 'google_maps',
        sourceUrl: target.sourceUrl,
        createdAt: target.createdAt.toISOString(),
      })),
    });
  });

  router.get('/', async (req, res) => {
    const targets = await service.list(currentUser(req).id);

    res.json({
      data: targets.map((target) => ({
        id: target.id,
        name: target.name,
        platform: 'google_maps',
        sourceUrl: target.sourceUrl,
        createdAt: target.createdAt.toISOString(),
      })),
    });
  });

  router.post('/', async (req, res) => {
    const input = createAnalysisTargetSchema.parse(req.body);
    const target = await service.create(currentUser(req).id, input);

    res.status(201).json({
      data: {
        id: target.id,
        name: target.name,
        platform: 'google_maps',
        sourceUrl: target.sourceUrl,
        createdAt: target.createdAt.toISOString(),
      },
    });
  });

  return router;
}
