import type { IngestionRun, Prisma, PrismaClient, Review } from '@prisma/client';
import type { NormalizedReview } from '../ingestion/review-normalizer.js';

/** The owner ID comes from the verified session, never from a review or URL body. */
export interface ReviewsRepository {
  findByTarget(ownerId: string, targetId: string): Promise<Review[]>;
  saveBatchAndFinishRun(
    ownerId: string,
    targetId: string,
    runId: string,
    reviews: readonly NormalizedReview[],
    stoppedEarly: IngestionRun['errorCode'],
  ): Promise<IngestionRun>;
}

export function createReviewsRepository(prisma: PrismaClient): ReviewsRepository {
  return {
    findByTarget(ownerId, targetId) {
      return prisma.review.findMany({
        // Both conditions run in SQL. A caller who guesses another target ID
        // cannot get its reviews even if the service's parent check is missed.
        where: { targetId, target: { ownerId } },
        // IDs break ties when reviews share the same millisecond timestamp.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    },

    saveBatchAndFinishRun(ownerId, targetId, runId, reviews, stoppedEarly) {
      // Fetching pages happens before this short transaction; waiting on the
      // provider while holding a DB transaction would keep locks open too long.
      // Recheck the parent here in case ownership/deletion changed during fetch.
      return prisma.$transaction(async (tx) => {
        const target = await tx.analysisTarget.findFirst({ where: { id: targetId, ownerId } });
        if (!target) throw new Error('Owned target was removed before reviews could be saved.');

        const inserted = await tx.review.createMany({
          data: reviews.map((review) => ({
            // Never take the target ID from a review: use the owned target above.
            targetId: target.id,
            sourceReviewId: review.sourceReviewId,
            text: review.text,
            rating: review.rating,
            reviewerName: review.reviewerName,
            publishedAt: review.publishedAt,
            reviewUrl: review.reviewUrl,
            // Prisma accepts JSON values, not arbitrary unknown objects. The
            // provider's JSON metadata is copied through a JSON round-trip.
            metadata: JSON.parse(JSON.stringify(review.metadata)) as Prisma.InputJsonValue,
          })),
        });
        // A run counts rows actually inserted, not raw or merely valid reviews.
        // The update must match this owned target's still-running attempt; if it
        // cannot, throwing rolls the inserts back with the rest of the transaction.
        const updated = await tx.ingestionRun.updateMany({
          where: { id: runId, targetId: target.id, target: { ownerId }, status: 'RUNNING' },
          data: {
            status: 'SUCCEEDED',
            errorCode: stoppedEarly,
            reviewCount: inserted.count,
            completedAt: new Date(),
          },
        });
        if (updated.count !== 1) throw new Error('Ingestion run could not be completed.');
        const finished = await tx.ingestionRun.findFirst({
          where: { id: runId, targetId: target.id, target: { ownerId } },
        });
        if (!finished) throw new Error('Completed ingestion run could not be read.');
        return finished;
      });
    },
  };
}
