import { getOwnedTargetOrThrow, type OwnedTargetLookup } from '../targets/owned-target.js';
import type { ReviewsRepository } from './reviews.repository.js';

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
  };
}
