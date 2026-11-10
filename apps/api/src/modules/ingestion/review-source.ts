import type { IngestionErrorCode } from '@reviewlens/shared';

/** Saving can fail after fetching; a review source cannot report a persistence failure. */
export type SourceOutcomeCode = Exclude<IngestionErrorCode, 'PERSISTENCE_ERROR'>;

/**
 * One review as extracted from the source, before normalization (S1-020).
 * Fields the source did not supply, or supplied in an unusable form, are `null`.
 * Deciding whether a record is valid is the normalizer's job (S1-021), not the source's.
 */
export interface RawReview {
  sourceReviewId: string | null;
  text: string | null;
  rating: number | null;
  reviewerName: string | null;
  publishedAt: string | null;
  reviewUrl: string | null;
  metadata: Record<string, unknown>;
}

/** What the source reported about the place the reviews belong to. */
export interface SourcePlace {
  title: string | null;
  address: string | null;
  totalReviews: number | null;
}

/**
 * Source and provider failures are run outcomes, not thrown errors
 * (Engineering Standards §6.4). Only programming errors throw.
 */
export type FetchReviewsResult =
  | {
      ok: true;
      place: SourcePlace;
      reviews: RawReview[];
      /** Set when a later page failed and the reviews collected so far are returned. */
      stoppedEarly?: SourceOutcomeCode;
    }
  | { ok: false; errorCode: SourceOutcomeCode };

export interface FetchReviewsInput {
  sourceUrl: string;
  /** Upper bound on reviews returned (MAX_REVIEWS_PER_RUN). */
  maxReviews: number;
}

/**
 * Where ingestion gets reviews from. Production uses SerpApi (adapters/serpapi);
 * tests inject a fake. Nothing outside the adapter sees provider-specific types.
 */
export interface ReviewSource {
  fetchReviews(input: FetchReviewsInput): Promise<FetchReviewsResult>;
}
