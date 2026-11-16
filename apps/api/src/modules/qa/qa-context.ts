import type { Review } from '@prisma/client';
import type { QaContextReview } from './qa-model.js';

/**
 * Maps persisted reviews to the minimal fields the model needs. Owner IDs,
 * target IDs, URLs, and provider metadata never cross the model boundary.
 */
export function toContextReviews(reviews: readonly Review[]): QaContextReview[] {
  return reviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    text: review.text,
    reviewerName: review.reviewerName,
    publishedAt: review.publishedAt,
  }));
}
