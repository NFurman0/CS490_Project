import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import { estimateReviewTokens } from '../../src/modules/qa/qa-context.js';
import { createQaService } from '../../src/modules/qa/qa.service.js';
import { createReviewsRepository } from '../../src/modules/reviews/reviews.repository.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createFakeQaModel } from '../helpers/fake-qa-model.js';
import { seedTargetWithReviews } from '../helpers/qa-fixtures.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

function serviceWith(contextTokenBudget?: number) {
  const fake = createFakeQaModel();
  const service = createQaService({
    targets: createTargetsRepository(testPrisma),
    reviews: createReviewsRepository(testPrisma),
    model: fake.model,
    logger: createLogger('silent'),
    contextTokenBudget,
  });
  return { fake, service };
}

describe.skipIf(!hasTestDatabase)('Q&A review context from persisted data (database)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('sends each review once when ingestion has stored it twice', async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', []);
    const review = {
      targetId: seeded.target.id,
      sourceReviewId: 'google-1',
      text: 'Lovely scones.',
      rating: 5,
    };
    await testPrisma.review.create({ data: review }); // first ingestion run
    await testPrisma.review.create({ data: review }); // second run stores it again
    const { fake, service } = serviceWith();

    const result = await service.ask(seeded.ownerId, seeded.target.id, 'What do people like?');

    expect(fake.lastRequest().reviews.map((r) => r.text)).toEqual(['Lovely scones.']);
    expect(fake.lastRequest().availableReviewCount).toBe(1);
    expect(result.reviewCount).toBe(1);
  });

  it('sends the latest version of a review that changed between ingestion runs', async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', []);
    const base = { targetId: seeded.target.id, sourceReviewId: 'google-2' };
    await testPrisma.review.create({
      data: {
        ...base,
        text: 'Scones were perfect.',
        rating: 5,
        createdAt: new Date('2026-10-01T10:00:00Z'),
      },
    });
    await testPrisma.review.create({
      data: {
        ...base,
        text: 'Scones were stale this time.',
        rating: 2,
        createdAt: new Date('2026-10-08T10:00:00Z'),
      },
    });
    const { fake, service } = serviceWith();

    await service.ask(seeded.ownerId, seeded.target.id, 'How are the scones?');

    expect(fake.lastRequest().reviews).toEqual([
      expect.objectContaining({ text: 'Scones were stale this time.', rating: 2 }),
    ]);
    expect(fake.everythingSent()).not.toContain('Scones were perfect.');
  });

  it('reflects the current persisted reviews on every question', async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', [
      { text: 'Old review about the patio.', rating: 4 },
    ]);
    const { fake, service } = serviceWith();

    await service.ask(seeded.ownerId, seeded.target.id, 'Anything about seating?');
    await testPrisma.review.deleteMany({ where: { targetId: seeded.target.id } });
    await testPrisma.review.create({
      data: { targetId: seeded.target.id, text: 'New review about the counter.', rating: 3 },
    });
    await service.ask(seeded.ownerId, seeded.target.id, 'Anything about seating?');

    expect(JSON.stringify(fake.requests[1])).toContain('New review about the counter.');
    expect(JSON.stringify(fake.requests[1])).not.toContain('Old review about the patio.');
  });

  it('trims a large dataset to the budget and tells the caller', async () => {
    const reviews = Array.from({ length: 10 }, (_, i) => ({
      text: `${i} ${'t'.repeat(400)}`,
      rating: 4,
    }));
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', reviews);
    const perReview = estimateReviewTokens({
      id: 'x',
      rating: 4,
      text: `0 ${'t'.repeat(400)}`,
      reviewerName: null,
      publishedAt: null,
    });
    const { fake, service } = serviceWith(perReview * 4);

    const result = await service.ask(seeded.ownerId, seeded.target.id, 'Summarize the reviews.');

    expect(fake.lastRequest().reviews).toHaveLength(4);
    expect(fake.lastRequest().availableReviewCount).toBe(10);
    expect(result.context).toEqual({ reviewsUsed: 4, truncated: true });
    expect(result.reviewCount).toBe(10);
  });
});
