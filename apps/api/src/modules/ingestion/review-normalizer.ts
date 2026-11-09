import type { RawReview } from './review-source.js';

/** Provider-independent review data ready for S1-022 to persist. */
export interface NormalizedReview {
  sourceReviewId: string | null;
  text: string;
  rating: number;
  reviewerName: string | null;
  publishedAt: string | null;
  reviewUrl: string | null;
  metadata: Record<string, unknown>;
}

export type NormalizeReviewsResult =
  | { ok: true; reviews: NormalizedReview[] }
  | { ok: false; errorCode: 'SOURCE_NO_REVIEWS' };

/** Filters one record at a time, retaining the source order of usable reviews. */
export function normalizeReviews(rawReviews: readonly RawReview[]): NormalizeReviewsResult {
  const reviews: NormalizedReview[] = [];

  for (const raw of rawReviews) {
    const text = raw.text?.trim();
    // No inferred stars: a missing, non-finite, or out-of-range rating cannot be saved.
    // Zero-width formatting characters are not visible text even though trim keeps them.
    if (!text || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(text)) continue;
    if (raw.rating === null || !Number.isFinite(raw.rating)) continue;
    if (raw.rating < 1 || raw.rating > 5) continue;

    reviews.push({
      sourceReviewId: nonblank(raw.sourceReviewId),
      text,
      rating: raw.rating, // Fractional ratings (e.g. 4.5) are retained without rounding.
      reviewerName: nonblank(raw.reviewerName),
      publishedAt: validDate(raw.publishedAt),
      reviewUrl: validUrl(raw.reviewUrl),
      metadata: { ...raw.metadata },
    });
  }

  // A resolved place whose records are all unusable must be a failed run, not success.
  return reviews.length > 0 ? { ok: true, reviews } : { ok: false, errorCode: 'SOURCE_NO_REVIEWS' };
}

function nonblank(value: string | null): string | null {
  return value?.trim() || null;
}

/** Keep ISO dates/timestamps only; an invalid optional date becomes null. */
function validDate(value: string | null): string | null {
  const date = nonblank(value);
  if (!date) return null;

  // Require an unambiguous ISO date or timestamp with a timezone; Date.parse alone
  // silently rolls invalid calendar dates such as February 30 into March.
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(
    date,
  );
  if (!match || !Number.isFinite(Date.parse(date))) return null;
  const calendarDay = match[1];
  const parsedDay = Date.parse(`${calendarDay}T00:00:00Z`);
  return Number.isFinite(parsedDay) && new Date(parsedDay).toISOString().slice(0, 10) === calendarDay
    ? date
    : null;
}

/** A malformed or non-web optional URL becomes null, without dropping the review. */
function validUrl(value: string | null): string | null {
  const url = nonblank(value);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}
