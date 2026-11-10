import type { Logger } from '../../lib/logger.js';
import type {
  RawReview,
  SourceOutcomeCode,
  SourcePlace,
} from '../../modules/ingestion/review-source.js';
import { classifyProviderError, parseReviewsPage } from './serpapi.parser.js';
import type { PlaceRef } from './place-url.js';

export const SERPAPI_SEARCH_URL = 'https://serpapi.com/search.json';

/** SerpApi accepts `num` (up to 20) only on pages after the first. */
const LATER_PAGE_SIZE = 20;

export interface FetchPageOptions {
  apiKey: string;
  ref: PlaceRef;
  /** `null` for the first page. */
  nextPageToken: string | null;
  /** 1-based page number, for logs. */
  page: number;
  fetchFn: typeof fetch;
  timeoutMs: number;
  logger: Logger;
}

export type FetchPageResult =
  | {
      ok: true;
      place: SourcePlace;
      reviews: RawReview[];
      nextPageToken: string | null;
    }
  | { ok: false; errorCode: SourceOutcomeCode };

/**
 * Fetches one page of reviews from SerpApi.
 *
 * The request URL carries `api_key` as a query parameter, so it is never
 * logged, thrown, or returned (docs/security-guardrails.md §7). Logs contain
 * only the page number, HTTP status, and outcome code.
 */
export async function fetchReviewsPage(options: FetchPageOptions): Promise<FetchPageResult> {
  const { fetchFn, timeoutMs, logger, page } = options;

  let res: Response;
  try {
    res = await fetchFn(buildRequestUrl(options), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    const errorCode: SourceOutcomeCode =
      name === 'TimeoutError' || name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR';
    logger.warn({ page, errorName: name, errorCode }, 'SerpApi request failed');
    return { ok: false, errorCode };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    logger.warn(
      { page, httpStatus: res.status, errorCode: 'PROVIDER_ERROR' },
      'SerpApi returned a body that is not JSON',
    );
    return { ok: false, errorCode: 'PROVIDER_ERROR' };
  }

  const parsed = parseReviewsPage(json);

  if (parsed.kind === 'invalid') {
    logger.warn(
      { page, httpStatus: res.status, errorCode: 'PROVIDER_ERROR' },
      'SerpApi response had an unexpected shape',
    );
    return { ok: false, errorCode: 'PROVIDER_ERROR' };
  }

  if (parsed.kind === 'error' || !res.ok) {
    const errorText = parsed.kind === 'error' ? parsed.errorText : null;
    let errorCode = classifyProviderError(res.status, errorText);
    // "No results" for a place SerpApi did identify means the place has no reviews.
    if (errorCode === 'SOURCE_UNRESOLVABLE' && parsed.place.title !== null) {
      errorCode = 'SOURCE_NO_REVIEWS';
    }
    logger.warn({ page, httpStatus: res.status, errorCode }, 'SerpApi reported an error');
    return { ok: false, errorCode };
  }

  return {
    ok: true,
    place: parsed.place,
    reviews: parsed.reviews,
    nextPageToken: parsed.nextPageToken,
  };
}

function buildRequestUrl({ apiKey, ref, nextPageToken }: FetchPageOptions): URL {
  const params = new URLSearchParams({ engine: 'google_maps_reviews', hl: 'en' });
  if ('dataId' in ref) params.set('data_id', ref.dataId);
  else params.set('place_id', ref.placeId);
  params.set('sort_by', 'newestFirst');
  if (nextPageToken) {
    params.set('next_page_token', nextPageToken);
    params.set('num', String(LATER_PAGE_SIZE));
  }
  params.set('api_key', apiKey);

  const url = new URL(SERPAPI_SEARCH_URL);
  url.search = params.toString();
  return url;
}
