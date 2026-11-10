import type { AnalysisTarget } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import type { ReviewsRepository } from './reviews.repository.js';

export interface ReviewTargetLookup {
  findById(ownerId: string, targetId: string): Promise<AnalysisTarget | null>;
}

export function createReviewsService(targets: ReviewTargetLookup, reviews: ReviewsRepository) {
  return {
    async list(ownerId: string, targetId: string) {
      // The URL only selects a target; it does not prove the caller owns it.
      // Check the parent before touching any child Review data.
      const target = await targets.findById(ownerId, targetId);
      if (!target) throw new AppError('NOT_FOUND', 'Analysis target not found.');
      // The read still scopes by owner in SQL, even after the parent check.
      return reviews.findByTarget(ownerId, target.id);
    },
  };
}
