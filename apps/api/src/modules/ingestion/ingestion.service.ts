import type { AnalysisTarget, IngestionRun } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { FinishedRun, IngestionRunsRepository } from './ingestion-runs.repository.js';
import { normalizeReviews } from './review-normalizer.js';
import type { ReviewSource } from './review-source.js';

/** The part of the targets repository ingestion needs. `findById` filters by owner. */
export interface OwnedTargetLookup {
  findById(ownerId: string, targetId: string): Promise<AnalysisTarget | null>;
}

export interface IngestionServiceDependencies {
  targets: OwnedTargetLookup;
  runs: IngestionRunsRepository;
  reviewSource: ReviewSource;
  /** MAX_REVIEWS_PER_RUN: upper bound on reviews fetched in one run. */
  maxReviewsPerRun: number;
  logger: Logger;
}

export type IngestionService = ReturnType<typeof createIngestionService>;

export function createIngestionService({
  targets,
  runs,
  reviewSource,
  maxReviewsPerRun,
  logger,
}: IngestionServiceDependencies) {
  return {
    /**
     * Starts ingestion for a target the caller owns (S1-019). The order of the
     * checks is required by docs/security-guardrails.md §4.3: a request for a
     * missing or not-owned target fails before any run is created or the review
     * source is called. Source and provider failures are run outcomes, not
     * errors (Engineering Standards §6.4).
     */
    async startIngestion(ownerId: string, targetId: string): Promise<IngestionRun> {
      // 1. Ownership first. Missing and not-owned look the same to the caller (§4.4).
      const target = await targets.findById(ownerId, targetId);
      if (!target) {
        throw new AppError('NOT_FOUND', 'Analysis target not found.');
      }

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
      try {
        const result = await reviewSource.fetchReviews({
          sourceUrl: target.sourceUrl,
          maxReviews: maxReviewsPerRun,
        });

        if (result.ok) {
          const normalized = normalizeReviews(result.reviews);
          // S1-022 will persist normalized.reviews under the owned target. For now,
          // reviewCount measures usable reviews, NOT reviews saved to the database.
          outcome = normalized.ok
            ? {
                status: 'SUCCEEDED',
                errorCode: result.stoppedEarly ?? null,
                reviewCount: normalized.reviews.length,
              }
            : { status: 'FAILED', errorCode: normalized.errorCode, reviewCount: 0 };
        } else {
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

      const finished = await runs.finish(run.id, outcome);
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
