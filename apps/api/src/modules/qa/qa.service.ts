import type { Logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import type { ReviewsRepository } from '../reviews/reviews.repository.js';
import { getOwnedTargetOrThrow, type OwnedTargetLookup } from '../targets/owned-target.js';
import { buildReviewContext, DEFAULT_CONTEXT_TOKEN_BUDGET } from './qa-context.js';
import { qaModelResponseSchema, type QaModel, type QaOutcome } from './qa-model.js';
import {
  buildSystemPrompt as defaultBuildSystemPrompt,
  type PromptTarget,
} from './system-prompt.js';

export interface QaServiceDependencies {
  targets: OwnedTargetLookup;
  reviews: Pick<ReviewsRepository, 'findByTarget'>;
  model: QaModel;
  logger: Logger;
  buildSystemPrompt?: (target: PromptTarget) => string;
  /** Maximum estimated tokens of review context per question (see docs/qa-context.md). */
  contextTokenBudget?: number;
}

export interface QaAnswer {
  target: { id: string; name: string; platform: string };
  /** `no_review_data`: The target has no reviews, so the model was not asked. */
  outcome: QaOutcome | 'no_review_data';
  answer: string;
  /** Distinct reviews the target has (duplicates from repeated ingestion removed). */
  reviewCount: number;
  /** How much of the dataset the answer was based on, so the UI can say so when trimmed. */
  context: { reviewsUsed: number; truncated: boolean };
}

const AI_UNAVAILABLE_MESSAGE =
  'ReviewLens couldn’t answer right now. Your reviews are safe; please try again in a moment.';

/**
 * Q&A orchestration. Every question rebuilds its context from the database for
 * the owned, active target, so no earlier target's reviews can carry over and no
 * other user's reviews can reach the model.
 */
export function createQaService({
  targets,
  reviews,
  model,
  logger,
  buildSystemPrompt = defaultBuildSystemPrompt,
  contextTokenBudget = DEFAULT_CONTEXT_TOKEN_BUDGET,
}: QaServiceDependencies) {
  return {
    async ask(ownerId: string, targetId: string, question: string): Promise<QaAnswer> {
      // Ownership first: another user's target fails before any review is read.
      const target = await getOwnedTargetOrThrow(targets, ownerId, targetId);
      const rows = await reviews.findByTarget(ownerId, target.id);
      const summary = { id: target.id, name: target.name, platform: target.platform };

      if (rows.length === 0) {
        return {
          target: summary,
          outcome: 'no_review_data',
          answer:
            'This target has no ingested reviews yet. Ingest reviews before asking questions.',
          reviewCount: 0,
          context: { reviewsUsed: 0, truncated: false },
        };
      }

      // Built fresh for every question from this target's rows only: nothing from an
      // earlier question or target can carry over (S2-BR-023, S2-BR-024).
      const context = buildReviewContext(rows, contextTokenBudget);
      if (context.truncated) {
        logger.info(
          {
            targetId: target.id,
            reviewsUsed: context.reviews.length,
            availableReviews: context.availableReviews,
            estimatedTokens: context.estimatedTokens,
          },
          'Q&A review context trimmed to the token budget',
        );
      }

      let raw: unknown;
      try {
        raw = await model.complete({
          systemPrompt: buildSystemPrompt(summary),
          target: { name: target.name, platform: target.platform },
          reviews: context.reviews,
          availableReviewCount: context.availableReviews,
          question,
        });
      } catch (error) {
        logger.error({ err: error, targetId: target.id }, 'AI model request failed');
        throw new AppError('AI_SERVICE_UNAVAILABLE', AI_UNAVAILABLE_MESSAGE);
      }

      // Model output is untrusted: an unexpected shape is a provider failure, not an answer.
      const parsed = qaModelResponseSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ targetId: target.id }, 'AI model returned an unusable response');
        throw new AppError('AI_SERVICE_UNAVAILABLE', AI_UNAVAILABLE_MESSAGE);
      }

      return {
        target: summary,
        ...parsed.data,
        reviewCount: context.availableReviews,
        context: { reviewsUsed: context.reviews.length, truncated: context.truncated },
      };
    },
  };
}

export type QaService = ReturnType<typeof createQaService>;
