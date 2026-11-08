import { describe, expect, it } from 'vitest';
import { loadSerpApiFixture } from '../../../test/helpers/serpapi-fixtures.js';
import { classifyProviderError, parseReviewsPage } from './serpapi.parser.js';

describe('parseReviewsPage', () => {
  it('extracts each review with its text, rating, and metadata', () => {
    const parsed = parseReviewsPage(loadSerpApiFixture('reviews-page-1.json'));
    if (parsed.kind !== 'page') throw new Error(`expected a page, got ${parsed.kind}`);

    expect(parsed.reviews).toHaveLength(3);
    expect(parsed.nextPageToken).toBe('FIXTURE_TOKEN_PAGE_2');
    expect(parsed.place).toEqual({
      title: 'Corner Slice Pizzeria',
      address: '123 Example Ave, Newark, NJ 07102',
      totalReviews: 1287,
    });
    expect(parsed.reviews[0]).toEqual({
      sourceReviewId: 'FIXTURE_REVIEW_1',
      text: 'Best plain slice in the area. Crust is thin and crispy and the line moves fast.',
      rating: 5,
      reviewerName: 'Sample Reviewer A',
      publishedAt: '2026-10-30T18:22:41Z',
      reviewUrl: 'https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sFIXTURE_REVIEW_1',
      metadata: {
        likes: 3,
        relativeDate: 'a week ago',
        reviewerIsLocalGuide: true,
        ownerResponse: { text: 'Thanks for stopping by!', publishedAt: '2026-10-31T14:00:00Z' },
      },
    });
  });

  it('prefers the original-language text over Google’s translated snippet', () => {
    const parsed = parseReviewsPage(loadSerpApiFixture('reviews-page-1.json'));
    if (parsed.kind !== 'page') throw new Error('expected a page');
    expect(parsed.reviews[2]?.text).toBe('Buena pizza, personal amable.');
  });

  it('reports no next page on the last page', () => {
    const parsed = parseReviewsPage(loadSerpApiFixture('reviews-page-2.json'));
    if (parsed.kind !== 'page') throw new Error('expected a page');
    expect(parsed.reviews).toHaveLength(2);
    expect(parsed.nextPageToken).toBeNull();
  });

  it('keeps every malformed record, with null for each unusable field, without throwing', () => {
    const parsed = parseReviewsPage(loadSerpApiFixture('reviews-malformed.json'));
    if (parsed.kind !== 'page') throw new Error('expected a page');

    expect(parsed.place.totalReviews).toBeNull();
    expect(parsed.reviews).toHaveLength(6);
    const [missingText, badRating, noMetadata, blankText, notObject, nullRecord] = parsed.reviews;

    expect(missingText).toMatchObject({
      sourceReviewId: 'FIXTURE_MISSING_TEXT',
      text: null,
      rating: 4,
    });
    expect(badRating).toMatchObject({ sourceReviewId: 'FIXTURE_BAD_RATING', rating: null });
    expect(badRating?.text).toBe('Rating came back as a string.');
    expect(noMetadata).toEqual({
      sourceReviewId: 'FIXTURE_NO_METADATA',
      text: 'No reviewer, date, or link on this one.',
      rating: 1,
      reviewerName: null,
      publishedAt: null,
      reviewUrl: null,
      metadata: {},
    });
    expect(blankText).toMatchObject({ text: null, reviewerName: null, rating: 3 });
    for (const record of [notObject, nullRecord]) {
      expect(record).toMatchObject({ sourceReviewId: null, text: null, rating: null });
    }
  });

  it('treats a page without a reviews array as an empty page', () => {
    expect(parseReviewsPage({ search_metadata: { status: 'Success' } })).toMatchObject({
      kind: 'page',
      reviews: [],
      nextPageToken: null,
    });
  });

  it('returns the provider error text when SerpApi reports an error', () => {
    expect(parseReviewsPage(loadSerpApiFixture('error-quota.json'))).toMatchObject({
      kind: 'error',
      errorText: 'Your account has run out of searches.',
    });
  });

  it.each([
    ['a non-object body', 'Service Unavailable'],
    ['reviews that are not an array', { reviews: { 0: 'x' } }],
    ['null', null],
  ])('flags %s as invalid', (_label, body) => {
    expect(parseReviewsPage(body)).toEqual({ kind: 'invalid' });
  });
});

describe('classifyProviderError', () => {
  it.each([
    [429, null, 'PROVIDER_QUOTA_EXHAUSTED'],
    [200, 'Your account has run out of searches.', 'PROVIDER_QUOTA_EXHAUSTED'],
    [200, "Google hasn't returned any results for this query.", 'SOURCE_UNRESOLVABLE'],
    [400, 'Invalid data_id parameter.', 'SOURCE_UNRESOLVABLE'],
    [
      401,
      'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key',
      'PROVIDER_ERROR',
    ],
    [500, null, 'PROVIDER_ERROR'],
  ] as const)('maps HTTP %i with %j to %s', (status, text, expected) => {
    expect(classifyProviderError(status, text)).toBe(expected);
  });
});
