import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { reviewSummaryResponseSchema } from '@reviewlens/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import { createQaService } from '../../src/modules/qa/qa.service.js';
import { createReviewsRepository } from '../../src/modules/reviews/reviews.repository.js';
import { createReviewsRouter, REVIEWS_PATH } from '../../src/modules/reviews/reviews.routes.js';
import { createReviewsService } from '../../src/modules/reviews/reviews.service.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createFakeQaModel } from '../helpers/fake-qa-model.js';
import { createTestApp } from '../helpers/test-app.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

const users = createUsersRepository(testPrisma);
const targets = createTargetsRepository(testPrisma);
const reviews = createReviewsRepository(testPrisma);
const sourceUrl = 'https://maps.google.com/?cid=123456';
const summaryUrl = (targetId: string) => `/api/analysis-targets/${targetId}/reviews/summary`;

function appFor(clerkUserId: string | null) {
  return createTestApp({
    as: clerkUserId,
    users,
    extraRouters: [
      { path: REVIEWS_PATH, router: createReviewsRouter(createReviewsService(targets, reviews)) },
    ],
  });
}

async function createTarget(clerkUserId: string, name: string) {
  const owner = await users.findOrCreate(clerkUserId);
  const target = await targets.create(owner.id, { name, platform: 'GOOGLE_MAPS', sourceUrl });
  return { owner, target };
}

describe.skipIf(!hasTestDatabase)('persisted review summary (PostgreSQL)', () => {
  beforeEach(resetDatabase);
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('changes its count and average when saved reviews are added or removed', async () => {
    const { target } = await createTarget('clerk_a', 'Cafe A');
    const app = appFor('clerk_a');
    const empty = reviewSummaryResponseSchema.parse(
      (await request(app).get(summaryUrl(target.id)).expect(200)).body,
    );
    expect(empty.data).toMatchObject({
      target: { id: target.id, name: 'Cafe A', platform: 'google_maps' },
      reviewCount: 0,
      averageRating: null,
    });

    const first = await testPrisma.review.create({
      data: { targetId: target.id, sourceReviewId: 'one', text: 'Great.', rating: 5 },
    });
    await testPrisma.review.create({
      data: { targetId: target.id, sourceReviewId: 'two', text: 'Okay.', rating: 3 },
    });
    const afterAdding = reviewSummaryResponseSchema.parse(
      (await request(app).get(summaryUrl(target.id)).expect(200)).body,
    );
    expect(afterAdding.data).toMatchObject({ reviewCount: 2, averageRating: 4 });

    await testPrisma.review.delete({ where: { id: first.id } });
    const afterRemoving = reviewSummaryResponseSchema.parse(
      (await request(app).get(summaryUrl(target.id)).expect(200)).body,
    );
    expect(afterRemoving.data).toMatchObject({ reviewCount: 1, averageRating: 3 });
  });

  it('matches the Q&A dataset after a review changes across ingestion runs', async () => {
    const { owner, target } = await createTarget('clerk_a', 'Cafe A');
    await testPrisma.review.create({
      data: {
        targetId: target.id,
        sourceReviewId: 'one',
        text: 'Old opinion.',
        rating: 5,
        createdAt: new Date('2026-11-20T12:00:00Z'),
      },
    });
    await testPrisma.review.create({
      data: {
        targetId: target.id,
        sourceReviewId: 'one',
        text: 'Updated opinion.',
        rating: 2,
        createdAt: new Date('2026-11-20T12:01:00Z'),
      },
    });
    await testPrisma.review.create({
      data: {
        targetId: target.id,
        sourceReviewId: 'two',
        text: 'Still good.',
        rating: 4,
        createdAt: new Date('2026-11-20T12:02:00Z'),
      },
    });

    const response = reviewSummaryResponseSchema.parse(
      (await request(appFor('clerk_a')).get(summaryUrl(target.id)).expect(200)).body,
    );
    expect(response.data).toMatchObject({ reviewCount: 2, averageRating: 3 });

    const fake = createFakeQaModel();
    const qa = createQaService({
      targets,
      reviews,
      model: fake.model,
      logger: createLogger('silent'),
    });
    const answer = await qa.ask(owner.id, target.id, 'What do customers think?');
    expect(answer.reviewCount).toBe(response.data.reviewCount);
    expect(fake.lastRequest().reviews.map((review) => review.rating)).toEqual([2, 4]);
  });

  it('keeps each target separate and denies another user the same summary as a missing target', async () => {
    const a = await createTarget('clerk_a', 'Cafe A');
    const b = await createTarget('clerk_a', 'Cafe B');
    const other = await createTarget('clerk_b', 'Cafe C');
    await testPrisma.review.create({ data: { targetId: a.target.id, text: 'A', rating: 1 } });
    await testPrisma.review.create({ data: { targetId: b.target.id, text: 'B', rating: 5 } });
    await testPrisma.review.create({ data: { targetId: other.target.id, text: 'C', rating: 3 } });

    const appA = appFor('clerk_a');
    const summaryA = reviewSummaryResponseSchema.parse(
      (await request(appA).get(summaryUrl(a.target.id)).expect(200)).body,
    );
    const summaryB = reviewSummaryResponseSchema.parse(
      (await request(appA).get(summaryUrl(b.target.id)).expect(200)).body,
    );
    expect(summaryA.data).toMatchObject({ reviewCount: 1, averageRating: 1 });
    expect(summaryB.data).toMatchObject({ reviewCount: 1, averageRating: 5 });

    const appB = appFor('clerk_b');
    const foreign = (await request(appB).get(summaryUrl(a.target.id)).expect(404)).body;
    const missing = (await request(appB).get(summaryUrl(randomUUID())).expect(404)).body;
    const malformed = (await request(appB).get(summaryUrl('not-a-uuid')).expect(404)).body;
    for (const response of [foreign, missing, malformed]) {
      expect(response.error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Analysis target not found.',
      });
    }
    expect(JSON.stringify(foreign)).not.toContain('Cafe A');
    await request(appFor(null)).get(summaryUrl(a.target.id)).expect(401);
  });
});
