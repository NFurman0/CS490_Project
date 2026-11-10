import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import { createIngestionRunsRepository } from '../../src/modules/ingestion/ingestion-runs.repository.js';
import {
  createIngestionRouter,
  INGESTION_RUNS_PATH,
} from '../../src/modules/ingestion/ingestion.routes.js';
import { createIngestionService } from '../../src/modules/ingestion/ingestion.service.js';
import type {
  FetchReviewsResult,
  ReviewSource,
} from '../../src/modules/ingestion/review-source.js';
import { createReviewsRepository } from '../../src/modules/reviews/reviews.repository.js';
import { createReviewsRouter, REVIEWS_PATH } from '../../src/modules/reviews/reviews.routes.js';
import { createReviewsService } from '../../src/modules/reviews/reviews.service.js';
import { createTargetsRouter } from '../../src/modules/targets/targets.routes.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createTargetsService } from '../../src/modules/targets/targets.service.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createTestApp } from '../helpers/test-app.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

/**
 * S1-013: one user can't read, change, or ingest into another user's target or its
 * child records (ingestion runs, reviews), even with the target's real ID. Every
 * user-data endpoint is checked three ways (security guardrails §6): signed out →
 * 401, owner → success, other user → 404 with no leaked data and no database change.
 */

const users = createUsersRepository(testPrisma);
const targetsRepository = createTargetsRepository(testPrisma);
const reviewsRepository = createReviewsRepository(testPrisma);

const A = 'clerk_user_a';
const B = 'clerk_user_b';
const A_NAME = "User A's Pizza";
const A_SOURCE = 'https://maps.google.com/?cid=111111';
const A_REVIEW = 'User A review: best crust in town';
const B_NAME = "User B's Tacos";
const B_SOURCE = 'https://maps.google.com/?cid=222222';
const B_REVIEW = 'User B review: great salsa';
const INGESTED_REVIEW = 'Freshly ingested review';

const succeeded: FetchReviewsResult = {
  ok: true,
  place: { title: null, address: null, totalReviews: 1 },
  reviews: [
    {
      sourceReviewId: 'r1',
      text: INGESTED_REVIEW,
      rating: 5,
      reviewerName: null,
      publishedAt: null,
      reviewUrl: null,
      metadata: {},
    },
  ],
};

/** The full targets, ingestion and reviews API as one Clerk user (or signed out). */
function appFor(clerkUserId: string | null) {
  const fetchReviews = vi.fn<ReviewSource['fetchReviews']>(async () => succeeded);
  const targetsService = createTargetsService({
    repository: targetsRepository,
    validateSourceUrl: async () => true,
  });
  const ingestionService = createIngestionService({
    targets: targetsRepository,
    runs: createIngestionRunsRepository(testPrisma),
    reviews: reviewsRepository,
    reviewSource: { fetchReviews },
    maxReviewsPerRun: 50,
    logger: createLogger('silent'),
  });
  const reviewsService = createReviewsService(targetsRepository, reviewsRepository);
  // Same mounts as server.ts.
  const app = createTestApp({
    as: clerkUserId,
    users,
    extraRouters: [
      { path: '/analysis-targets', router: createTargetsRouter(targetsService) },
      { path: INGESTION_RUNS_PATH, router: createIngestionRouter(ingestionService) },
      { path: REVIEWS_PATH, router: createReviewsRouter(reviewsService) },
    ],
  });
  return { app, fetchReviews };
}

const targetUrl = (id: string) => `/api/analysis-targets/${id}`;
const runsUrl = (id: string) => `/api/analysis-targets/${id}/ingestion-runs`;
const latestRunUrl = (id: string) => `/api/analysis-targets/${id}/ingestion-runs/latest`;
const reviewsUrl = (id: string) => `/api/analysis-targets/${id}/reviews`;

type Method = 'get' | 'post' | 'delete';

/** Every endpoint that reads or changes one target or its child records. */
const TARGET_ENDPOINTS: [label: string, method: Method, url: (id: string) => string][] = [
  ['GET target', 'get', targetUrl],
  ['DELETE target', 'delete', targetUrl],
  ['POST ingestion run', 'post', runsUrl],
  ['GET latest ingestion run', 'get', latestRunUrl],
  ['GET reviews', 'get', reviewsUrl],
];

function send(app: ReturnType<typeof appFor>['app'], method: Method, url: string) {
  const req = request(app)[method](url);
  return method === 'post' ? req.send({}) : req;
}

async function createTarget(clerkUserId: string, name: string, sourceUrl: string) {
  const owner = await users.findOrCreate(clerkUserId);
  return targetsRepository.create(owner.id, { name, platform: 'GOOGLE_MAPS', sourceUrl });
}

async function seedReview(targetId: string, text: string) {
  await testPrisma.review.create({ data: { targetId, text, rating: 4 } });
}

/** User A's target with one saved review and one finished run; User B's target with one review. */
async function seedBothUsers() {
  const targetA = await createTarget(A, A_NAME, A_SOURCE);
  const targetB = await createTarget(B, B_NAME, B_SOURCE);
  await seedReview(targetA.id, A_REVIEW);
  await seedReview(targetB.id, B_REVIEW);
  await testPrisma.ingestionRun.create({
    data: { targetId: targetA.id, status: 'SUCCEEDED', reviewCount: 1, completedAt: new Date() },
  });
  return { targetA, targetB };
}

/** Everything a cross-user request must leave untouched. */
async function snapshot() {
  return {
    targets: await testPrisma.analysisTarget.findMany({ orderBy: { id: 'asc' } }),
    runs: await testPrisma.ingestionRun.findMany({ orderBy: { id: 'asc' } }),
    reviews: await testPrisma.review.findMany({ orderBy: { id: 'asc' } }),
  };
}

/** The response must not contain anything that identifies User A's target or reviews. */
function expectNoUserALeak(body: unknown, targetAId: string) {
  const text = JSON.stringify(body);
  for (const secret of [targetAId, A_NAME, A_SOURCE, A_REVIEW]) {
    expect(text).not.toContain(secret);
  }
}

describe.skipIf(!hasTestDatabase)('cross-user authorization (S1-013)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe('signed out', () => {
    it.each<[string, Method, (id: string) => string]>([
      ['GET target list', 'get', () => '/api/analysis-targets'],
      ['GET recent targets', 'get', () => '/api/analysis-targets/recent'],
      ['POST target', 'post', () => '/api/analysis-targets'],
      ...TARGET_ENDPOINTS,
    ])('%s returns 401 and changes nothing', async (_label, method, url) => {
      const { targetA } = await seedBothUsers();
      const before = await snapshot();
      const { app, fetchReviews } = appFor(null);

      const res = await send(app, method, url(targetA.id)).expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expectNoUserALeak(res.body, targetA.id);
      expect(await snapshot()).toEqual(before);
      expect(fetchReviews).not.toHaveBeenCalled();
    });
  });

  describe('owner', () => {
    it('can read their own target, latest run and reviews', async () => {
      const { targetA } = await seedBothUsers();
      const { app } = appFor(A);

      const target = await request(app).get(targetUrl(targetA.id)).expect(200);
      const run = await request(app).get(latestRunUrl(targetA.id)).expect(200);
      const reviews = await request(app).get(reviewsUrl(targetA.id)).expect(200);

      expect(target.body.data).toMatchObject({ id: targetA.id, name: A_NAME });
      expect(run.body.data).toMatchObject({ targetId: targetA.id, status: 'succeeded' });
      expect(reviews.body.data.map((r: { text: string }) => r.text)).toEqual([A_REVIEW]);
    });

    it('can start ingestion on their own target and the reviews are saved under it', async () => {
      const { targetA } = await seedBothUsers();
      const { app, fetchReviews } = appFor(A);

      const res = await request(app).post(runsUrl(targetA.id)).send({}).expect(201);

      expect(res.body.data).toMatchObject({ targetId: targetA.id, status: 'succeeded' });
      expect(fetchReviews).toHaveBeenCalledOnce();
      const saved = await testPrisma.review.findMany({ where: { text: INGESTED_REVIEW } });
      expect(saved.map((r) => r.targetId)).toEqual([targetA.id]);
    });

    it('can delete their own target', async () => {
      const { targetA } = await seedBothUsers();

      await request(appFor(A).app).delete(targetUrl(targetA.id)).expect(204);

      expect(await testPrisma.analysisTarget.count({ where: { id: targetA.id } })).toBe(0);
    });
  });

  describe("another user using User A's real target ID", () => {
    it.each(TARGET_ENDPOINTS)(
      '%s returns 404, leaks nothing and changes nothing',
      async (_label, method, url) => {
        const { targetA } = await seedBothUsers();
        const before = await snapshot();
        const { app, fetchReviews } = appFor(B);

        const res = await send(app, method, url(targetA.id)).expect(404);

        expect(res.body.error.code).toBe('NOT_FOUND');
        expectNoUserALeak(res.body, targetA.id);
        // No run, no reviews, no deletion: the database is exactly as it was.
        expect(await snapshot()).toEqual(before);
        expect(fetchReviews).not.toHaveBeenCalled();
      },
    );

    it.each(TARGET_ENDPOINTS)(
      "%s answers User A's real target exactly like a target that doesn't exist",
      async (_label, method, url) => {
        const { targetA } = await seedBothUsers();
        const { app } = appFor(B);

        const real = await send(app, method, url(targetA.id)).expect(404);
        const unknown = await send(app, method, url(randomUUID())).expect(404);

        expect(real.body.error).toEqual({
          ...unknown.body.error,
          requestId: real.body.error.requestId,
        });
      },
    );
  });

  describe('lists', () => {
    it.each(['/api/analysis-targets', '/api/analysis-targets/recent'])(
      '%s returns only the signed-in user’s targets',
      async (url) => {
        const { targetA, targetB } = await seedBothUsers();

        const asA = await request(appFor(A).app).get(url).expect(200);
        const asB = await request(appFor(B).app).get(url).expect(200);

        expect(asA.body.data.map((t: { id: string }) => t.id)).toEqual([targetA.id]);
        expect(asB.body.data.map((t: { id: string }) => t.id)).toEqual([targetB.id]);
        expectNoUserALeak(asB.body, targetA.id);
      },
    );

    it("never returns User A's reviews when User B reads their own target's reviews", async () => {
      const { targetA, targetB } = await seedBothUsers();

      const res = await request(appFor(B).app).get(reviewsUrl(targetB.id)).expect(200);

      expect(res.body.data.map((r: { text: string }) => r.text)).toEqual([B_REVIEW]);
      expectNoUserALeak(res.body, targetA.id);
    });
  });

  describe('request bodies cannot redirect ownership', () => {
    it('rejects a new target whose body names another user as owner', async () => {
      await seedBothUsers();
      const userA = await users.findOrCreate(A);
      const before = await snapshot();

      const res = await request(appFor(B).app)
        .post('/api/analysis-targets')
        .send({ name: B_NAME, sourceUrl: B_SOURCE, ownerId: userA.id })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await snapshot()).toEqual(before);
    });

    it("rejects an ingestion body that names User A's target or owner, creating no run or reviews", async () => {
      const { targetA, targetB } = await seedBothUsers();
      const userA = await users.findOrCreate(A);
      const before = await snapshot();
      const { app, fetchReviews } = appFor(B);

      const res = await request(app)
        .post(runsUrl(targetB.id))
        .send({ targetId: targetA.id, ownerId: userA.id })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await snapshot()).toEqual(before);
      expect(fetchReviews).not.toHaveBeenCalled();
    });

    it("saves reviews from User B's own ingestion only under User B's target", async () => {
      const { targetA, targetB } = await seedBothUsers();
      const reviewsUnderA = await testPrisma.review.findMany({ where: { targetId: targetA.id } });

      await request(appFor(B).app).post(runsUrl(targetB.id)).send({}).expect(201);

      const saved = await testPrisma.review.findMany({ where: { text: INGESTED_REVIEW } });
      expect(saved.map((r) => r.targetId)).toEqual([targetB.id]);
      expect(await testPrisma.review.findMany({ where: { targetId: targetA.id } })).toEqual(
        reviewsUnderA,
      );
    });
  });
});
