import type { IngestionRun, Prisma, PrismaClient, Review } from '@prisma/client';
import type { NormalizedReview } from '../ingestion/review-normalizer.js';

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
        where: { targetId, target: { ownerId } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    },

    saveBatchAndFinishRun(ownerId, targetId, runId, reviews, stoppedEarly) {
      // Fetching pages happens before this short transaction. Checking the parent
      // inside it prevents a stale ownership check from authorizing inserts.
      return prisma.$transaction(async (tx) => {
        const target = await tx.analysisTarget.findFirst({ where: { id: targetId, ownerId } });
        if (!target) throw new Error('Owned target was removed before reviews could be saved.');

        const inserted = await tx.review.createMany({
          data: reviews.map((review) => ({
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
