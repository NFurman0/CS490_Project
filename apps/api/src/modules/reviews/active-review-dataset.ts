import type { Review } from '@prisma/client';

/** Re-ingestion can save the same source review more than once. */
export function reviewIdentity(review: Pick<Review, 'sourceReviewId' | 'rating' | 'text'>): string {
  if (review.sourceReviewId) return `source:${review.sourceReviewId}`;
  return `text:${review.rating}:${review.text.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/**
 * Q&A and the ingestion summary use these same persisted, distinct rows.
 * Rows arrive oldest first. Keep the latest stored copy of each review at its
 * original position, so a later edit changes the rating and text in both views.
 */
export function selectActiveReviewRows(rows: readonly Review[]): Review[] {
  const positionByIdentity = new Map<string, number>();
  const distinct: Review[] = [];
  for (const row of rows) {
    const identity = reviewIdentity(row);
    const position = positionByIdentity.get(identity);
    if (position === undefined) {
      positionByIdentity.set(identity, distinct.length);
      distinct.push(row);
    } else {
      distinct[position] = row;
    }
  }
  return distinct;
}
