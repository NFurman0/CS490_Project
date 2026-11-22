import type { Review } from '@prisma/client';
import type { ReviewSummary } from '@reviewlens/shared';
import { selectActiveReviewRows } from './active-review-dataset.js';

/** Compute the full active dataset's count and rating from saved Review rows. */
export function summarizeReviews(
  rows: readonly Review[],
): Pick<ReviewSummary, 'reviewCount' | 'averageRating'> {
  const activeRows = selectActiveReviewRows(rows);
  if (activeRows.length === 0) return { reviewCount: 0, averageRating: null };

  const ratingTotal = activeRows.reduce((sum, row) => sum + row.rating, 0);
  return {
    reviewCount: activeRows.length,
    averageRating: ratingTotal / activeRows.length,
  };
}
