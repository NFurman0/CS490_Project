import { describe, expect, it } from 'vitest';
import { normalizeReviews } from './review-normalizer.js';
import type { RawReview } from './review-source.js';

function rawReview(overrides: Partial<RawReview> = {}): RawReview {
  // Start from a valid source record so each test changes only the condition
  // it is checking (for example, null text versus an out-of-range rating).
  return {
    sourceReviewId: null,
    text: 'A helpful review',
    rating: 4,
    reviewerName: null,
    publishedAt: null,
    reviewUrl: null,
    metadata: {},
    ...overrides,
  };
}

const noReviews = { ok: false, errorCode: 'SOURCE_NO_REVIEWS' };

describe('normalizeReviews', () => {
  it('retains the exact text and rating of a valid review', () => {
    expect(normalizeReviews([rawReview({ text: 'Great pizza!', rating: 3 })])).toMatchObject({
      ok: true,
      reviews: [{ text: 'Great pizza!', rating: 3 }],
    });
  });

  it('trims surrounding whitespace without changing internal words', () => {
    expect(normalizeReviews([rawReview({ text: ' \n  Really  good pizza! \t' })])).toMatchObject({
      reviews: [{ text: 'Really  good pizza!' }],
    });
  });

  it('excludes null text', () => {
    expect(normalizeReviews([rawReview({ text: null })])).toEqual(noReviews);
  });

  it.each(['', '  \n\t '])('excludes empty or whitespace-only text %j', (text) => {
    expect(normalizeReviews([rawReview({ text })])).toEqual(noReviews);
  });

  it('excludes text made only of invisible format characters', () => {
    expect(normalizeReviews([rawReview({ text: '\u200B' })])).toEqual(noReviews);
  });

  it('excludes a missing rating rather than inventing one', () => {
    expect(normalizeReviews([rawReview({ rating: null })])).toEqual(noReviews);
  });

  it.each([NaN, Infinity, -Infinity])('excludes a non-finite rating %s', (rating) => {
    expect(normalizeReviews([rawReview({ rating })])).toEqual(noReviews);
  });

  it('excludes ratings below 1', () => {
    expect(normalizeReviews([rawReview({ rating: 0.9 })])).toEqual(noReviews);
  });

  it('excludes ratings above 5', () => {
    expect(normalizeReviews([rawReview({ rating: 5.1 })])).toEqual(noReviews);
  });

  // The endpoints prove the range is inclusive; 4.5 catches accidental rounding.
  it.each([1, 5, 4.5])('accepts rating %s unchanged', (rating) => {
    expect(normalizeReviews([rawReview({ rating })])).toMatchObject({
      ok: true,
      reviews: [{ rating }],
    });
  });

  it('accepts valid reviews without optional source details', () => {
    expect(normalizeReviews([rawReview()])).toEqual({
      ok: true,
      reviews: [
        {
          sourceReviewId: null,
          text: 'A helpful review',
          rating: 4,
          reviewerName: null,
          publishedAt: null,
          reviewUrl: null,
          metadata: {},
        },
      ],
    });
  });

  it('preserves usable optional fields and source metadata', () => {
    // A nested metadata value matters here: the contract retains provider
    // details even though NormalizedReview itself has no provider-specific type.
    const metadata = { likes: 3, ownerResponse: { text: 'Thank you!' } };
    expect(
      normalizeReviews([
        rawReview({
          sourceReviewId: 'source-123',
          reviewerName: 'Sam',
          publishedAt: '2026-10-30T18:22:41Z',
          reviewUrl: 'https://www.google.com/maps/reviews/123',
          metadata,
        }),
      ]),
    ).toEqual({
      ok: true,
      reviews: [
        {
          sourceReviewId: 'source-123',
          text: 'A helpful review',
          rating: 4,
          reviewerName: 'Sam',
          publishedAt: '2026-10-30T18:22:41Z',
          reviewUrl: 'https://www.google.com/maps/reviews/123',
          metadata,
        },
      ],
    });
  });

  it('sets unusable optional dates and URLs to null without losing the review', () => {
    expect(
      normalizeReviews([
        rawReview({
          publishedAt: '2026-02-30T10:00:00Z',
          reviewUrl: 'not a URL',
        }),
      ]),
    ).toMatchObject({
      ok: true,
      reviews: [{ publishedAt: null, reviewUrl: null }],
    });
  });

  it('keeps valid neighbors in source order when one record is invalid', () => {
    // Filtering must not discard an entire page or reorder surviving records.
    expect(
      normalizeReviews([
        rawReview({ text: 'First', rating: 4.5 }),
        rawReview({ text: null }),
        rawReview({ text: 'Third', rating: 1 }),
      ]),
    ).toMatchObject({
      ok: true,
      reviews: [{ text: 'First', rating: 4.5 }, { text: 'Third', rating: 1 }],
    });
  });

  it('signals no usable reviews for an empty or all-invalid batch', () => {
    expect(normalizeReviews([])).toEqual(noReviews);
    expect(normalizeReviews([rawReview({ text: null }), rawReview({ rating: null })])).toEqual(
      noReviews,
    );
  });

  it('does not mutate raw reviews or their metadata while normalizing', () => {
    // A new top-level metadata object is expected; nested values need not be
    // deep-copied, but the source review must stay unchanged.
    const metadata = { likes: 2, ownerResponse: { text: 'Thanks!' } };
    const raw = rawReview({ text: '  Great!  ', metadata });
    const result = normalizeReviews([raw]);

    expect(raw.text).toBe('  Great!  ');
    expect(raw.metadata).toBe(metadata);
    expect(raw.metadata).toEqual({ likes: 2, ownerResponse: { text: 'Thanks!' } });
    if (!result.ok) throw new Error('expected a normalized review');
    expect(result.reviews[0]?.metadata).not.toBe(metadata);
  });
});
