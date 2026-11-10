import { z } from 'zod';
import type {
  RawReview,
  SourceOutcomeCode,
  SourcePlace,
} from '../../modules/ingestion/review-source.js';

/**
 * The parts of a SerpApi `google_maps_reviews` response we rely on.
 * Deliberately lenient: individual reviews stay `unknown` and are extracted
 * one at a time, so a single malformed record cannot reject the whole page.
 */
const pageSchema = z.object({
  error: z.string().optional(),
  place_info: z.record(z.string(), z.unknown()).optional(),
  reviews: z.array(z.unknown()).optional(),
  serpapi_pagination: z.object({ next_page_token: z.string().optional() }).optional(),
});

export type ParsedPage =
  | { kind: 'page'; place: SourcePlace; reviews: RawReview[]; nextPageToken: string | null }
  | { kind: 'error'; place: SourcePlace; errorText: string }
  | { kind: 'invalid' };

/** Parses one response body. Pure: no I/O, never throws. */
export function parseReviewsPage(json: unknown): ParsedPage {
  const result = pageSchema.safeParse(json);
  if (!result.success) return { kind: 'invalid' };

  const body = result.data;
  const place = parsePlace(body.place_info);
  if (body.error !== undefined) return { kind: 'error', place, errorText: body.error };

  return {
    kind: 'page',
    place,
    reviews: (body.reviews ?? []).map(extractReview),
    nextPageToken: str(body.serpapi_pagination?.next_page_token),
  };
}

/** Maps one SerpApi review object to a RawReview. Unusable fields become `null`. */
export function extractReview(value: unknown): RawReview {
  const r = obj(value);
  const user = obj(r.user);
  const extracted = obj(r.extracted_snippet);
  const response = obj(r.response);

  const metadata: Record<string, unknown> = {};
  const likes = num(r.likes);
  if (likes !== null) metadata.likes = likes;
  const relativeDate = str(r.date);
  if (relativeDate !== null) metadata.relativeDate = relativeDate;
  if (typeof user.local_guide === 'boolean') metadata.reviewerIsLocalGuide = user.local_guide;
  const ownerResponse = str(response.snippet);
  if (ownerResponse !== null) {
    metadata.ownerResponse = { text: ownerResponse, publishedAt: str(response.iso_date) };
  }

  return {
    sourceReviewId: str(r.review_id),
    text: str(extracted.original) ?? str(r.snippet),
    rating: num(r.rating),
    reviewerName: str(user.name),
    publishedAt: str(r.iso_date),
    reviewUrl: str(r.link),
    metadata,
  };
}

/**
 * Maps a SerpApi failure to an ingestion outcome code (Engineering Standards §6.4).
 * `errorText` is SerpApi's own message: used for classification only, never shown or stored.
 * The source-only return type cannot mistake a provider error for a DB save error.
 */
export function classifyProviderError(
  httpStatus: number,
  errorText: string | null,
): SourceOutcomeCode {
  const text = errorText ?? '';
  if (httpStatus === 429 || /run out of searches|plan.*limit|hourly.*limit/i.test(text)) {
    return 'PROVIDER_QUOTA_EXHAUSTED';
  }
  if (/hasn't returned any results|invalid (data_id|place_id)|couldn't find/i.test(text)) {
    return 'SOURCE_UNRESOLVABLE';
  }
  return 'PROVIDER_ERROR';
}

function parsePlace(info: Record<string, unknown> | undefined): SourcePlace {
  const p = info ?? {};
  return { title: str(p.title), address: str(p.address), totalReviews: num(p.reviews) };
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A string with visible content, or `null`. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A finite number, or `null`. Numeric strings are not coerced. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
