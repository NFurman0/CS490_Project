import type { AnalysisTarget, IngestionRun } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { FinishedRun, IngestionRunsRepository } from './ingestion-runs.repository.js';
import { normalizeReviews } from './review-normalizer.js';
import type { ReviewSource } from './review-source.js';
import type { ReviewsRepository } from '../reviews/reviews.repository.js';

/** The part of the targets repository ingestion needs. `findById` filters by owner. */
export interface OwnedTargetLookup {
  findById(ownerId: string, targetId: string): Promise<AnalysisTarget | null>;
}

export interface IngestionServiceDependencies {
  targets: OwnedTargetLookup;
  runs: IngestionRunsRepository;
  /** Saves usable reviews and finishes a successful run in one DB transaction. */
  reviews: ReviewsRepository;
  reviewSource: ReviewSource;
  /** MAX_REVIEWS_PER_RUN: upper bound on reviews fetched in one run. */
  maxReviewsPerRun: number;
  logger: Logger;
}

export type IngestionService = ReturnType<typeof createIngestionService>;

export function createIngestionService({
  targets,
  runs,
  reviews,
  reviewSource,
  maxReviewsPerRun,
  logger,
}: IngestionServiceDependencies) {
  async function getOwnedTargetOrThrow(ownerId: string, targetId: string): Promise<AnalysisTarget> {
    const target = await targets.findById(ownerId, targetId);
    if (!target) throw new AppError('NOT_FOUND', 'Analysis target not found.');
    return target;
  }

  return {
    async latestRun(ownerId: string, targetId: string): Promise<IngestionRun | null> {
      const target = await getOwnedTargetOrThrow(ownerId, targetId);
      return runs.findLatest(target.id);
    },

    /**
     * Starts ingestion for a target the caller owns (S1-019). The order of the
     * checks is required by docs/security-guardrails.md §4.3: a request for a
     * missing or not-owned target fails before any run is created or the review
     * source is called. Source and provider failures are run outcomes, not
     * errors (Engineering Standards §6.4).
     */
    async startIngestion(ownerId: string, targetId: string): Promise<IngestionRun> {
      // 1. Ownership first. Missing and not-owned look the same to the caller (§4.4).
      const target = await getOwnedTargetOrThrow(ownerId, targetId);

      // 2. Required source information (S1-BR-025).
      if (!target.sourceUrl?.trim()) {
        throw new AppError(
          'VALIDATION_FAILED',
          'This analysis target has no review source link. Add a Google Maps link and try again.',
        );
      }

      // 3. Only now record the attempt and call the source.
      const run = await runs.start(target.id);

      let outcome: FinishedRun;
      // A successful fetch may still normalize to zero usable reviews. Keep
      // the normalized result separate from the run outcome until a save succeeds.
      let normalizedReviews: ReturnType<typeof normalizeReviews> | null = null;
      try {
        const result = await reviewSource.fetchReviews({
          sourceUrl: target.sourceUrl,
          maxReviews: maxReviewsPerRun,
        });

        if (result.ok) {
          // `ok` here means the source returned RawReview records, not that
          // every record has usable text/rating. Make that decision here rather
          // than in the SerpApi adapter, so other providers follow the same rule.
          const normalized = normalizeReviews(result.reviews);
          normalizedReviews = normalized;
          // A partial page error is meaningful only when at least one usable
          // review remains; otherwise SOURCE_NO_REVIEWS explains the failed run.
          outcome = normalized.ok
            ? {
                status: 'SUCCEEDED',
                errorCode: result.stoppedEarly ?? null,
                reviewCount: 0, // The transaction replaces this with the inserted row count.
              }
            : { status: 'FAILED', errorCode: normalized.errorCode, reviewCount: 0 };
        } else {
          // A source/provider failure already has its own outcome code. There
          // are no raw reviews to normalize and the run counts zero reviews.
          outcome = { status: 'FAILED', errorCode: result.errorCode, reviewCount: 0 };
        }
      } catch (error) {
        // A bug or an error the adapter did not translate. Never leave the run
        // stuck in RUNNING; the central handler turns the rethrow into a generic 500.
        await runs.finish(run.id, {
          status: 'FAILED',
          errorCode: 'PROVIDER_ERROR',
          reviewCount: 0,
        });
        throw error;
      }

      let finished: IngestionRun;
      if (normalizedReviews?.ok) {
        try {
          // The repository commits inserts and SUCCEEDED together. If either
          // fails, PostgreSQL rolls the entire batch back; never claim it saved.
          finished = await reviews.saveBatchAndFinishRun(
            ownerId,
            target.id,
            run.id,
            normalizedReviews.reviews,
            outcome.errorCode,
          );
        } catch (error) {
          // This runs only for save failures, outside the provider try/catch:
          // labeling a database problem PROVIDER_ERROR would be misleading.
          try {
            await runs.finish(run.id, {
              status: 'FAILED',
              errorCode: 'PERSISTENCE_ERROR',
              reviewCount: 0,
            });
          } catch (finishError) {
            // If the DB itself is unavailable, even recording FAILED may fail.
            // Log both failures without sending either database detail to the client.
            logger.error(
              { err: finishError, runId: run.id },
              'could not record persistence failure',
            );
          }
          // The shared error handler sends a generic 500, not Prisma's error text.
          throw error;
        }
      } else {
        finished = await runs.finish(run.id, outcome);
      }
      logger.info(
        {
          runId: finished.id,
          targetId: target.id,
          status: finished.status,
          errorCode: finished.errorCode,
          reviewCount: finished.reviewCount,
        },
        'ingestion run finished',
      );
      return finished;
    },
  };
}
