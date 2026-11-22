import { getOwnedTargetOrThrow, type OwnedTargetLookup } from '../targets/owned-target.js';
import type { ReviewsRepository } from './reviews.repository.js';
import { summarizeReviews } from './review-summary.js';

export type ReviewTargetLookup = OwnedTargetLookup;

export function createReviewsService(targets: ReviewTargetLookup, reviews: ReviewsRepository) {
  return {
    async list(ownerId: string, targetId: string) {
      // The URL only selects a target; it does not prove the caller owns it.
      // Check the parent before touching any child Review data.
      const target = await getOwnedTargetOrThrow(targets, ownerId, targetId);
      // The read still scopes by owner in SQL, even after the parent check.
      return reviews.findByTarget(ownerId, target.id);
    },
    async summary(ownerId: string, targetId: string) {
      const target = await getOwnedTargetOrThrow(targets, ownerId, targetId);
      const rows = await reviews.findByTarget(ownerId, target.id);
      return {
        target: { id: target.id, name: target.name, platform: 'google_maps' as const },
        ...summarizeReviews(rows),
      };
    },
  };
}
