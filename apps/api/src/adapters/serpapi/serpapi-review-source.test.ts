import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, loadSerpApiFixture } from '../../../test/helpers/serpapi-fixtures.js';
import type { Logger } from '../../lib/logger.js';
import { createSerpApiReviewSource } from './serpapi-review-source.js';

const API_KEY = 'fixture_secret_key_value';
const DATA_ID = '0x89c25a197c06b7cb:0x40a06c78f79e5de6';
const SOURCE_URL = `https://www.google.com/maps/place/Corner+Slice/data=!4m6!3m5!1s${DATA_ID}!8m2`;

function spyLogger() {
  const calls: unknown[][] = [];
  const record =
    () =>
    (...args: unknown[]) => {
      calls.push(args);
    };
  const logger = { info: record(), warn: record(), error: record(), debug: record() };
  return { logger: logger as unknown as Logger, calls };
}

/** A fake SerpApi that serves page 1 or page 2 depending on next_page_token. */
function twoPageSerpApi() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    return jsonResponse(
      loadSerpApiFixture(
        url.searchParams.has('next_page_token') ? 'reviews-page-2.json' : 'reviews-page-1.json',
      ),
    );
  });
}

function sourceWith(fetchFn: typeof fetch, logger = spyLogger().logger) {
  return createSerpApiReviewSource({ apiKey: API_KEY, logger, fetchFn, timeoutMs: 1000 });
}

function requestedUrl(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>, call: number): URL {
  return new URL(String(fetchFn.mock.calls[call]?.[0]));
}

describe('SerpApi review source', () => {
  it('collects reviews across pages until there is no next page', async () => {
    const fetchFn = twoPageSerpApi();
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: SOURCE_URL,
      maxReviews: 50,
    });

    if (!result.ok) throw new Error(`expected success, got ${result.errorCode}`);
    expect(result.reviews.map((r) => r.sourceReviewId)).toEqual([
      'FIXTURE_REVIEW_1',
      'FIXTURE_REVIEW_2',
      'FIXTURE_REVIEW_3',
      'FIXTURE_REVIEW_4',
      'FIXTURE_REVIEW_5',
    ]);
    expect(result.place.title).toBe('Corner Slice Pizzeria');
    expect(result.stoppedEarly).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('asks SerpApi for the place by data_id, and sends the page token and size on later pages', async () => {
    const fetchFn = twoPageSerpApi();
    await sourceWith(fetchFn).fetchReviews({ sourceUrl: SOURCE_URL, maxReviews: 50 });

    const first = requestedUrl(fetchFn, 0);
    expect(first.origin + first.pathname).toBe('https://serpapi.com/search.json');
    expect(first.searchParams.get('engine')).toBe('google_maps_reviews');
    expect(first.searchParams.get('data_id')).toBe(DATA_ID);
    expect(first.searchParams.has('num')).toBe(false);

    const second = requestedUrl(fetchFn, 1);
    expect(second.searchParams.get('next_page_token')).toBe('FIXTURE_TOKEN_PAGE_2');
    expect(second.searchParams.get('num')).toBe('20');
  });

  it('stops paging once maxReviews is reached and trims to the cap', async () => {
    const fetchFn = twoPageSerpApi();
    const result = await sourceWith(fetchFn).fetchReviews({ sourceUrl: SOURCE_URL, maxReviews: 2 });

    if (!result.ok) throw new Error('expected success');
    expect(result.reviews).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fails with SOURCE_UNRESOLVABLE before calling SerpApi when the URL is not a place', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: 'https://www.google.com/maps/search/pizza',
      maxReviews: 50,
    });

    expect(result).toEqual({ ok: false, errorCode: 'SOURCE_UNRESOLVABLE' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails with SOURCE_NO_REVIEWS when the place has no reviews', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse(loadSerpApiFixture('reviews-empty.json')),
    );
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: SOURCE_URL,
      maxReviews: 50,
    });
    expect(result).toEqual({ ok: false, errorCode: 'SOURCE_NO_REVIEWS' });
  });

  it('fails with SOURCE_UNRESOLVABLE when SerpApi finds nothing for the place', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse(loadSerpApiFixture('error-no-results.json')),
    );
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: SOURCE_URL,
      maxReviews: 50,
    });
    expect(result).toEqual({ ok: false, errorCode: 'SOURCE_UNRESOLVABLE' });
  });

  it('fails with SOURCE_NO_REVIEWS when SerpApi finds the place but no results', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        place_info: { title: 'Brand New Cafe' },
        error: "Google hasn't returned any results for this query.",
      }),
    );
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: SOURCE_URL,
      maxReviews: 50,
    });
    expect(result).toEqual({ ok: false, errorCode: 'SOURCE_NO_REVIEWS' });
  });

  it.each([
    ['the quota error body', 200],
    ['HTTP 429', 429],
  ])('fails with PROVIDER_QUOTA_EXHAUSTED on %s', async (_label, status) => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse(loadSerpApiFixture('error-quota.json'), status),
    );
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: SOURCE_URL,
      maxReviews: 50,
    });
    expect(result).toEqual({ ok: false, errorCode: 'PROVIDER_QUOTA_EXHAUSTED' });
  });

  it('fails with PROVIDER_TIMEOUT when SerpApi does not respond in time', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: SOURCE_URL,
      maxReviews: 50,
    });
    expect(result).toEqual({ ok: false, errorCode: 'PROVIDER_TIMEOUT' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('fetch failed'))],
    [
      'a body that is not JSON',
      async () => new Response('<html>Bad gateway</html>', { status: 502 }),
    ],
    ['an unexpected response shape', async () => jsonResponse({ reviews: 'nope' })],
    ['an HTTP error without a body error', async () => jsonResponse({}, 500)],
  ])('fails with PROVIDER_ERROR on %s', async (_label, impl) => {
    const fetchFn = vi.fn<typeof fetch>(impl);
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: SOURCE_URL,
      maxReviews: 50,
    });
    expect(result).toEqual({ ok: false, errorCode: 'PROVIDER_ERROR' });
  });

  it('returns the reviews collected so far when a later page fails', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(loadSerpApiFixture('reviews-page-1.json')))
      .mockResolvedValueOnce(jsonResponse(loadSerpApiFixture('error-quota.json'), 429));
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: SOURCE_URL,
      maxReviews: 50,
    });

    if (!result.ok) throw new Error('expected success');
    expect(result.reviews).toHaveLength(3);
    expect(result.stoppedEarly).toBe('PROVIDER_QUOTA_EXHAUSTED');
  });

  it('stops instead of looping when a page is empty but has a next token', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(loadSerpApiFixture('reviews-page-1.json')))
      .mockResolvedValue(
        jsonResponse({ reviews: [], serpapi_pagination: { next_page_token: 'SAME' } }),
      );
    const result = await sourceWith(fetchFn).fetchReviews({
      sourceUrl: SOURCE_URL,
      maxReviews: 50,
    });

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('never logs the API key or the request URL', async () => {
    const { logger, calls } = spyLogger();
    const failing = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(loadSerpApiFixture('reviews-page-1.json')))
      .mockRejectedValueOnce(
        new TypeError(`fetch failed for https://serpapi.com/?api_key=${API_KEY}`),
      );

    await sourceWith(failing, logger).fetchReviews({ sourceUrl: SOURCE_URL, maxReviews: 50 });

    expect(calls.length).toBeGreaterThan(0);
    const logged = JSON.stringify(calls);
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain('serpapi.com');
  });
});
