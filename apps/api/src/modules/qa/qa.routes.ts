import { askQuestionRequestSchema } from '@reviewlens/shared';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { currentUser } from '../../lib/identity.js';
import type { QaService } from './qa.service.js';

/** Matches the path the web app's askQuestion(). */
export const QA_PATH = '/analysis-targets/:targetId/qa';
const targetIdSchema = z.uuid();

/**
 * POST /api/analysis-targets/:targetId/qa . Ask a question about the target's reviews.
 * Mounted inside /api's authentication. The service checks ownership before any
 * review is read or the model is called.
 */
export function createQaRouter(service: Pick<QaService, 'ask'>) {
  const router = Router({ mergeParams: true });
  router.post('/', async (req, res) => {
    const { targetId } = req.params as { targetId?: string };
    // A malformed ID looks like any missing or not-owned target.
    if (!targetIdSchema.safeParse(targetId).success) {
      throw new AppError('NOT_FOUND', 'Analysis target not found.');
    }
    const { question } = askQuestionRequestSchema.parse(req.body);
    const answer = await service.ask(currentUser(req).id, targetId as string, question);
    res.json({ data: answer });
  });
  return router;
}
