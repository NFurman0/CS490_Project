import type { Review } from '@prisma/client';
import type { QaContextReview } from './qa-model.js';

/**
 * Send ALL of the active target's reviews, deduplicated, up to a token budget.
 */

/** Default token budget for review context. Leaves room for the prompt and answer. */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 40_000;

/** Conservative estimate for English text: about 4 characters per token. */
const CHARS_PER_TOKEN = 4;

/** Allowance per review for its ID, rating, reviewer, date, and formatting. */
const PER_REVIEW_OVERHEAD_TOKENS = 25;

export interface ReviewContext {
  /** Reviews to send to the model, oldest first. */
  reviews: QaContextReview[];
  /** Distinct reviews the target has, after removing duplicates. */
  availableReviews: number;
  /** Duplicate rows dropped (the same review stored by more than one ingestion run). */
  duplicatesRemoved: number;
  /** True when the budget forced a subset; the user must be told (S2-BR-010). */
  truncated: boolean;
  estimatedTokens: number;
}

/** Rough token cost of one review in the context. */
export function estimateReviewTokens(review: QaContextReview): number {
  const characters = review.text.length + (review.reviewerName?.length ?? 0);
  return Math.ceil(characters / CHARS_PER_TOKEN) + PER_REVIEW_OVERHEAD_TOKENS;
}

/**
 * Re-running ingestion stores reviews again, so the same review can appear in
 * several rows. Keep the latest stored copy, so a reviewer’s edits are reflected.
 */
export function reviewIdentity(review: Pick<Review, 'sourceReviewId' | 'rating' | 'text'>): string {
  if (review.sourceReviewId) return `source:${review.sourceReviewId}`;
  return `text:${review.rating}:${review.text.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

function toContextReview(review: Review): QaContextReview {
  // Owner IDs, target IDs, URLs, and provider metadata never cross the model boundary.
  return {
    id: review.id,
    rating: review.rating,
    text: review.text,
    reviewerName: review.reviewerName,
    publishedAt: review.publishedAt,
  };
}

/** Rounds a rating into one of the five 1–5 star groups used for balanced selection. */
function ratingGroup(rating: number): number {
  return Math.min(5, Math.max(1, Math.round(rating)));
}

/**
 * Builds the model context from the target's persisted reviews, which the caller
 * has already loaded for the owned, active target. When over budget, it selects round-robin across star ratings, newest first within
 * each rating, so a subset still reflects both praise and complaints.
 */
export function buildReviewContext(
  rows: readonly Review[],
  tokenBudget: number = DEFAULT_CONTEXT_TOKEN_BUDGET,
): ReviewContext {
  // Rows arrive oldest first, so a later copy is the most recent ingestion of that
  // review (for example, after the reviewer edited it). Keep that copy, at the
  // position where the review first appeared.
  const positionByIdentity = new Map<string, number>();
  const distinct: Review[] = [];
  for (const row of rows) {
    const identity = reviewIdentity(row);
    const position = positionByIdentity.get(identity);
    if (position === undefined) {
      positionByIdentity.set(identity, distinct.length);
      distinct.push(row);
    } else {
      distinct[position] = row;
    }
  }

  const candidates = distinct.map((row, order) => {
    const review = toContextReview(row);
    return { order, review, tokens: estimateReviewTokens(review), group: ratingGroup(row.rating) };
  });
  const totalTokens = candidates.reduce((sum, candidate) => sum + candidate.tokens, 0);
  const base = {
    availableReviews: distinct.length,
    duplicatesRemoved: rows.length - distinct.length,
  };

  if (totalTokens <= tokenBudget) {
    return {
      ...base,
      reviews: candidates.map((candidate) => candidate.review),
      truncated: false,
      estimatedTokens: totalTokens,
    };
  }

  // Newest first within each star group; groups visited 1 to 5 stars in turn.
  const queues = [1, 2, 3, 4, 5].map((group) =>
    candidates.filter((candidate) => candidate.group === group).reverse(),
  );
  const selected: typeof candidates = [];
  let used = 0;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const queue of queues) {
      // Skip reviews that no longer fit; a shorter one later in the queue may.
      while (queue.length > 0 && used + queue[0]!.tokens > tokenBudget) queue.shift();
      const next = queue.shift();
      if (!next) continue;
      selected.push(next);
      used += next.tokens;
      progressed = true;
    }
  }

  selected.sort((a, b) => a.order - b.order);
  return {
    ...base,
    reviews: selected.map((candidate) => candidate.review),
    truncated: true,
    estimatedTokens: used,
  };
}
