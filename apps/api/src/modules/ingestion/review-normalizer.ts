import type { RawReview } from './review-source.js';

/**
 * The application-facing shape after validation. Unlike RawReview, required
 * text/rating cannot be null. This is data prepared for S1-022, not a saved row:
 * it intentionally has no database ID, owner ID, or SerpApi response type.
 */
export interface NormalizedReview {
  sourceReviewId: string | null;
  text: string;
  rating: number;
  reviewerName: string | null;
  publishedAt: string | null;
  reviewUrl: string | null;
  metadata: Record<string, unknown>;
}

// The `ok` discriminator forces callers to handle an all-invalid batch instead
// of interpreting an empty list as a successful ingestion.
export type NormalizeReviewsResult =
  | { ok: true; reviews: NormalizedReview[] }
  | { ok: false; errorCode: 'SOURCE_NO_REVIEWS' };

/** Pure transformation: no database, provider call, or mutation of RawReview inputs. */
export function normalizeReviews(rawReviews: readonly RawReview[]): NormalizeReviewsResult {
  const reviews: NormalizedReview[] = [];

  // Appending accepted records while scanning preserves their original order;
  // `continue` drops only the current bad record, not the rest of the batch.
  for (const raw of rawReviews) {
    // Trim only the edges: spaces within the actual review are part of its text.
    const text = raw.text?.trim();
    // L/N/P/S are visible Unicode letters, numbers, punctuation, or symbols.
    // In particular, trim alone does not remove a standalone zero-width character.
    if (!text || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(text)) continue;
    // Do not coerce a missing rating or invent stars. Number.isFinite rejects
    // NaN and either Infinity; the inclusive bounds still allow 1, 5, and 4.5.
    if (raw.rating === null || !Number.isFinite(raw.rating)) continue;
    if (raw.rating < 1 || raw.rating > 5) continue;

    // Optional details are independent of text/rating. An invalid date/link
    // becomes null; neither invalid optional value discards a usable review.
    reviews.push({
      sourceReviewId: nonblank(raw.sourceReviewId),
      text,
      rating: raw.rating, // Fractional ratings (e.g. 4.5) are retained without rounding.
      reviewerName: nonblank(raw.reviewerName),
      publishedAt: validDate(raw.publishedAt),
      reviewUrl: validUrl(raw.reviewUrl),
      // Copy the top-level record so normalization does not edit the source's
      // metadata object. Nested values are preserved, not deep-cloned.
      metadata: { ...raw.metadata },
    });
  }

  // A resolved place whose records are all unusable must be a failed run, not success.
  return reviews.length > 0 ? { ok: true, reviews } : { ok: false, errorCode: 'SOURCE_NO_REVIEWS' };
}

function nonblank(value: string | null): string | null {
  // Used only for optional strings: a missing/blank value means "not available".
  return value?.trim() || null;
}

/** Keep valid ISO dates/timestamps as source strings; invalid ones become null. */
function validDate(value: string | null): string | null {
  const date = nonblank(value);
  if (!date) return null;

  // Require YYYY-MM-DD, optionally followed by T time and Z/offset. Parsing
  // alone is too lenient: JavaScript can roll February 30 into March.
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(
    date,
  );
  if (!match || !Number.isFinite(Date.parse(date))) return null;
  const calendarDay = match[1];
  // Check the written calendar day at UTC midnight, separately from the
  // timestamp's offset (which could move the instant into another UTC day).
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
    // URL parsing accepts other schemes too; review links must be HTTP(S).
    // Return the trimmed original rather than rewriting the provider's link.
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}
