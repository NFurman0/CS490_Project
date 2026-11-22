import type { Review } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildReviewContext } from '../qa/qa-context.js';
import { summarizeReviews } from './review-summary.js';

function row(id: string, rating: number, sourceReviewId: string | null = id): Review {
  return {
    id,
    targetId: 'target-1',
    sourceReviewId,
    text: `Review ${id}`,
    rating,
    reviewerName: null,
    publishedAt: null,
    reviewUrl: null,
    metadata: {},
    createdAt: new Date('2026-11-21T12:00:00Z'),
  } as Review;
}

describe('summarizeReviews', () => {
  it('returns zero reviews and no rating for an empty saved dataset', () => {
    expect(summarizeReviews([])).toEqual({ reviewCount: 0, averageRating: null });
  });

  it('uses the same distinct latest copies that Q&A uses, including fractional ratings', () => {
    const rows = [row('old', 5, 'source-1'), row('latest', 2.5, 'source-1'), row('other', 4)];

    expect(summarizeReviews(rows)).toEqual({ reviewCount: 2, averageRating: 3.25 });
    const context = buildReviewContext(rows);
    expect(context.availableReviews).toBe(2);
    expect(context.reviews.map((review) => review.rating)).toEqual([2.5, 4]);
  });
});
