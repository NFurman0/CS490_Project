import type { Review } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildReviewContext,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  estimateReviewTokens,
  reviewIdentity,
} from './qa-context.js';

let sequence = 0;

function row(overrides: Partial<Review> = {}): Review {
  sequence += 1;
  return {
    id: `r${sequence}`,
    targetId: 'target-1',
    sourceReviewId: `src-${sequence}`,
    text: `Review number ${sequence}.`,
    rating: 4,
    reviewerName: 'Sam',
    publishedAt: '2026-10-01',
    reviewUrl: `https://maps.google.com/review/${sequence}`,
    metadata: { provider: 'serpapi' },
    createdAt: new Date(2026, 9, 1, 0, 0, sequence),
    ...overrides,
  } as Review;
}

const ids = (context: { reviews: { id: string }[] }) => context.reviews.map((review) => review.id);

describe('buildReviewContext', () => {
  it('supplies every review, oldest first, when the dataset fits the budget', () => {
    const rows = [row(), row(), row()];

    const context = buildReviewContext(rows);

    expect(ids(context)).toEqual(rows.map((r) => r.id));
    expect(context).toMatchObject({ availableReviews: 3, duplicatesRemoved: 0, truncated: false });
  });

  it('sends only the fields an answer needs', () => {
    const [review] = buildReviewContext([row({ id: 'only' })]).reviews;

    expect(Object.keys(review!).sort()).toEqual([
      'id',
      'publishedAt',
      'rating',
      'reviewerName',
      'text',
    ]);
  });

  it('removes the same review stored by two ingestion runs, keeping the first copy', () => {
    const first = row({ sourceReviewId: 'google-123' });
    const again = row({ sourceReviewId: 'google-123' });
    const other = row();

    const context = buildReviewContext([first, again, other]);

    expect(ids(context)).toEqual([again.id, other.id]);
    expect(context).toMatchObject({ availableReviews: 2, duplicatesRemoved: 1 });
  });

  it('matches reviews without a source ID by rating and normalized text', () => {
    const a = row({ sourceReviewId: null, text: 'Great  coffee!', rating: 5 });
    const b = row({ sourceReviewId: null, text: ' great coffee! ', rating: 5 });
    const differentRating = row({ sourceReviewId: null, text: 'Great coffee!', rating: 3 });

    const context = buildReviewContext([a, b, differentRating]);

    expect(ids(context)).toEqual([b.id, differentRating.id]);
  });

  it('uses the latest text and rating when a reviewer edited their review', () => {
    const original = row({ sourceReviewId: 'google-9', text: 'Fantastic service.', rating: 5 });
    const edited = row({
      sourceReviewId: 'google-9',
      text: 'Service has gone downhill.',
      rating: 2,
    });

    const context = buildReviewContext([original, edited]);

    expect(context.reviews).toEqual([
      expect.objectContaining({ text: 'Service has gone downhill.', rating: 2 }),
    ]);
    expect(context).toMatchObject({ availableReviews: 1, duplicatesRemoved: 1 });
  });

  it('keeps reviews with identical text but different source IDs', () => {
    const rows = [
      row({ text: 'Good.', sourceReviewId: 'a' }),
      row({ text: 'Good.', sourceReviewId: 'b' }),
    ];

    expect(buildReviewContext(rows).reviews).toHaveLength(2);
  });

  it('trims to the budget and reports that the context is a subset', () => {
    const rows = Array.from({ length: 20 }, () => row({ text: 'x'.repeat(400) }));
    const perReview = estimateReviewTokens(buildReviewContext([rows[0]!]).reviews[0]!);

    const context = buildReviewContext(rows, perReview * 5);

    expect(context.reviews).toHaveLength(5);
    expect(context).toMatchObject({ availableReviews: 20, truncated: true });
    expect(context.estimatedTokens).toBeLessThanOrEqual(perReview * 5);
  });

  it('keeps praise and complaints when trimming, instead of only the most common rating', () => {
    const fiveStar = Array.from({ length: 12 }, () => row({ rating: 5, text: 'y'.repeat(400) }));
    const oneStar = Array.from({ length: 3 }, () => row({ rating: 1, text: 'z'.repeat(400) }));
    const perReview = estimateReviewTokens(buildReviewContext([fiveStar[0]!]).reviews[0]!);

    const context = buildReviewContext([...fiveStar, ...oneStar], perReview * 6);
    const ratings = context.reviews.map((review) => review.rating);

    expect(ratings.filter((rating) => rating === 1)).toHaveLength(3);
    expect(ratings.filter((rating) => rating === 5)).toHaveLength(3);
  });

  it('prefers the newest reviews within a rating when trimming', () => {
    const rows = Array.from({ length: 6 }, () => row({ rating: 4, text: 'w'.repeat(400) }));
    const perReview = estimateReviewTokens(buildReviewContext([rows[0]!]).reviews[0]!);

    const context = buildReviewContext(rows, perReview * 2);

    expect(ids(context)).toEqual([rows[4]!.id, rows[5]!.id]);
  });

  it('fits a shorter review when a longer one would exceed the remaining budget', () => {
    const long = row({ rating: 2, text: 'l'.repeat(4000) });
    const short = row({ rating: 2, text: 'Short.' });
    const filler = row({ rating: 5, text: 'f'.repeat(400) });
    const budget = estimateReviewTokens(buildReviewContext([filler]).reviews[0]!) + 40;

    const context = buildReviewContext([short, long, filler], budget);

    expect(ids(context)).toEqual([short.id, filler.id]);
    expect(ids(context)).not.toContain(long.id);
  });

  it('gives the same result every time for the same input', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ rating: (i % 5) + 1, text: 'v'.repeat(300) }),
    );

    expect(buildReviewContext(rows, 1000)).toEqual(buildReviewContext(rows, 1000));
  });

  it('fits a default-size ingestion run (50 reviews) without trimming', () => {
    const run = Array.from({ length: 50 }, () => row({ text: 'r'.repeat(1000) }));

    expect(buildReviewContext(run, DEFAULT_CONTEXT_TOKEN_BUDGET).truncated).toBe(false);
  });
});

describe('reviewIdentity', () => {
  it('uses the source review ID when present', () => {
    expect(reviewIdentity({ sourceReviewId: 'g1', rating: 5, text: 'a' })).toBe('source:g1');
  });
});
