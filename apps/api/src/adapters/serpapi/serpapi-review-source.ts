import type { Logger } from '../../lib/logger.js';
import type {
  FetchReviewsResult,
  RawReview,
  ReviewSource,
  SourcePlace,
} from '../../modules/ingestion/review-source.js';
import { resolvePlaceRef } from './place-url.js';
import { fetchReviewsPage } from './serpapi.client.js';

export interface SerpApiReviewSourceConfig {
  apiKey: string;
  logger: Logger;
  /** Injected so tests never touch the network. Defaults to Node's global fetch. */
  fetchFn?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Gets Google Maps reviews through SerpApi's Google Maps Reviews API
 * (docs/ingestion-approach.md). Each page costs one SerpApi search, so paging
 * stops as soon as `maxReviews` is reached.
 */
export function createSerpApiReviewSource({
  apiKey,
  logger,
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: SerpApiReviewSourceConfig): ReviewSource {
  return {
    async fetchReviews({ sourceUrl, maxReviews }): Promise<FetchReviewsResult> {
      const ref = await resolvePlaceRef(sourceUrl, { fetchFn, timeoutMs });
      if (!ref) {
        logger.info({ errorCode: 'SOURCE_UNRESOLVABLE' }, 'source URL is not a Google Maps place');
        return { ok: false, errorCode: 'SOURCE_UNRESOLVABLE' };
      }

      const reviews: RawReview[] = [];
      let place: SourcePlace = { title: null, address: null, totalReviews: null };
      let nextPageToken: string | null = null;

      for (let page = 1; reviews.length < maxReviews; page++) {
        const result = await fetchReviewsPage({
          apiKey,
          ref,
          nextPageToken,
          page,
          fetchFn,
          timeoutMs,
          logger,
        });

        if (!result.ok) {
          if (page === 1) return { ok: false, errorCode: result.errorCode };
          logger.warn(
            { page, reviewsCollected: reviews.length, errorCode: result.errorCode },
            'stopped paging after a later page failed',
          );
          return { ok: true, place, reviews, stoppedEarly: result.errorCode };
        }

        if (page === 1) place = result.place;
        reviews.push(...result.reviews);
        nextPageToken = result.nextPageToken;
        // An empty page with a token would otherwise loop and spend searches.
        if (!nextPageToken || result.reviews.length === 0) break;
      }

      if (reviews.length === 0) return { ok: false, errorCode: 'SOURCE_NO_REVIEWS' };
      return { ok: true, place, reviews: reviews.slice(0, maxReviews) };
    },
  };
}
