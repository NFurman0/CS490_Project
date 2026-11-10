import type { Review } from '@prisma/client';
import { type ReviewResponse } from '@reviewlens/shared';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { currentUser } from '../../lib/identity.js';
import type { createReviewsService } from './reviews.service.js';

export const REVIEWS_PATH = '/analysis-targets/:targetId/reviews';
const targetIdSchema = z.uuid();

function toResponse(review: Review): ReviewResponse {
  return {
    id: review.id,
    targetId: review.targetId,
    sourceReviewId: review.sourceReviewId,
    text: review.text,
    rating: review.rating,
    reviewerName: review.reviewerName,
    publishedAt: review.publishedAt,
    reviewUrl: review.reviewUrl,
    metadata: review.metadata as Record<string, unknown>,
    createdAt: review.createdAt.toISOString(),
  };
}

export function createReviewsRouter(service: ReturnType<typeof createReviewsService>) {
  const router = Router({ mergeParams: true });
  router.get('/', async (req, res) => {
    const { targetId } = req.params as { targetId?: string };
    if (!targetIdSchema.safeParse(targetId).success) {
      throw new AppError('NOT_FOUND', 'Analysis target not found.');
    }
    const reviews = await service.list(currentUser(req).id, targetId as string);
    res.json({ data: reviews.map(toResponse) });
  });
  return router;
}
