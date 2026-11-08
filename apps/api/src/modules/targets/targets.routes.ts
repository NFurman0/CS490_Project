import { createAnalysisTargetSchema } from '@reviewlens/shared';
import { Router } from 'express';
import { currentUser } from '../../lib/identity.js';
import type { createTargetsService } from './targets.service.js';

type TargetsService = ReturnType<typeof createTargetsService>;

export function createTargetsRouter(service: TargetsService) {
  const router = Router();

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
