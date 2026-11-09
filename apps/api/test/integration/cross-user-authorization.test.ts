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
import { createTargetsRouter } from '../../src/modules/targets/targets.routes.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createTargetsService } from '../../src/modules/targets/targets.service.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createTestApp } from '../helpers/test-app.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

/**
 * S1-013: one user can't read, change, or ingest into another user's target or its
 * child records, even with the target's real ID. Every user-data endpoint is checked
 * three ways (security guardrails §6): signed out → 401, owner → success, other
 * user → 404 with no leaked data and no change to the database.
 */

const users = createUsersRepository(testPrisma);
const targetsRepository = createTargetsRepository(testPrisma);

const A = 'clerk_user_a';
const B = 'clerk_user_b';
const A_NAME = "User A's Pizza";
const A_SOURCE = 'https://maps.google.com/?cid=111111';
const B_NAME = "User B's Tacos";
const B_SOURCE = 'https://maps.google.com/?cid=222222';

const succeeded: FetchReviewsResult = {
  ok: true,
  place: { title: A_NAME, address: null, totalReviews: 1 },
  reviews: [
    {
      sourceReviewId: 'r1',
      text: 'Great',
      rating: 5,
      reviewerName: null,
      publishedAt: null,
      reviewUrl: null,
      metadata: {},
    },
  ],
};

/** The full targets + ingestion API as one Clerk user (or signed out), with a fake review source. */
function appFor(clerkUserId: string | null) {
  const fetchReviews = vi.fn<ReviewSource['fetchReviews']>(async () => succeeded);
  const targetsService = createTargetsService({
    repository: targetsRepository,
    validateSourceUrl: async () => true,
  });
  const ingestionService = createIngestionService({
    targets: targetsRepository,
    runs: createIngestionRunsRepository(testPrisma),
    reviewSource: { fetchReviews },
    maxReviewsPerRun: 50,
    logger: createLogger('silent'),
  });
  const app = createTestApp({
    as: clerkUserId,
    users,
    extraRouters: [
      { path: '/analysis-targets', router: createTargetsRouter(targetsService) },
      { path: INGESTION_RUNS_PATH, router: createIngestionRouter(ingestionService) },
    ],
  });
  return { app, fetchReviews };
}

const runsUrl = (targetId: string) => `/api/analysis-targets/${targetId}/ingestion-runs`;

async function createTarget(clerkUserId: string, name: string, sourceUrl: string) {
  const owner = await users.findOrCreate(clerkUserId);
  return targetsRepository.create(owner.id, { name, platform: 'GOOGLE_MAPS', sourceUrl });
}

/** Everything a cross-user request must leave untouched. */
async function snapshot() {
  return {
    targets: await testPrisma.analysisTarget.findMany({ orderBy: { id: 'asc' } }),
    runs: await testPrisma.ingestionRun.findMany({ orderBy: { id: 'asc' } }),
  };
}

/** The response must not contain anything that identifies User A's target. */
function expectNoTargetALeak(body: unknown, targetAId: string) {
  const text = JSON.stringify(body);
  expect(text).not.toContain(targetAId);
  expect(text).not.toContain(A_NAME);
  expect(text).not.toContain(A_SOURCE);
}

describe.skipIf(!hasTestDatabase)('cross-user authorization (S1-013)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe('signed out', () => {
    it.each([
      ['GET', '/api/analysis-targets'],
      ['GET', '/api/analysis-targets/recent'],
      ['POST', '/api/analysis-targets'],
      ['POST', '/api/analysis-targets/33333333-3333-4333-8333-333333333333/ingestion-runs'],
    ] as const)('%s %s returns 401 and changes nothing', async (method, url) => {
      await createTarget(A, A_NAME, A_SOURCE);
      const before = await snapshot();
      const { app, fetchReviews } = appFor(null);

      const req = method === 'GET' ? request(app).get(url) : request(app).post(url);
      const res = await req.send(method === 'POST' ? {} : undefined).expect(401);

      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(await snapshot()).toEqual(before);
      expect(fetchReviews).not.toHaveBeenCalled();
    });
  });

  describe('listing targets', () => {
    it.each(['/api/analysis-targets', '/api/analysis-targets/recent'])(
      '%s returns only the signed-in user’s targets',
      async (url) => {
        const targetA = await createTarget(A, A_NAME, A_SOURCE);
        const targetB = await createTarget(B, B_NAME, B_SOURCE);

        const asA = await request(appFor(A).app).get(url).expect(200);
        const asB = await request(appFor(B).app).get(url).expect(200);

        expect(asA.body.data.map((t: { id: string }) => t.id)).toEqual([targetA.id]);
        expect(asB.body.data.map((t: { id: string }) => t.id)).toEqual([targetB.id]);
        expectNoTargetALeak(asB.body, targetA.id);
      },
    );
  });

  describe('creating targets', () => {
    it("rejects owner fields that point at another user and leaves that user's data alone", async () => {
      await createTarget(A, A_NAME, A_SOURCE);
      const userA = await users.findOrCreate(A);
      const before = await snapshot();

      const res = await request(appFor(B).app)
        .post('/api/analysis-targets')
        .send({ name: B_NAME, sourceUrl: B_SOURCE, ownerId: userA.id })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('starting ingestion', () => {
    it('lets the owner start ingestion on their own target', async () => {
      const targetA = await createTarget(A, A_NAME, A_SOURCE);
      const { app, fetchReviews } = appFor(A);

      const res = await request(app).post(runsUrl(targetA.id)).expect(201);

      expect(res.body.data.targetId).toBe(targetA.id);
      expect(fetchReviews).toHaveBeenCalledOnce();
    });

    it("returns 404 for another user's target with no run, no source call and no change", async () => {
      const targetA = await createTarget(A, A_NAME, A_SOURCE);
      await createTarget(B, B_NAME, B_SOURCE);
      // An earlier run of A's must stay exactly as it was.
      await request(appFor(A).app).post(runsUrl(targetA.id)).expect(201);
      const before = await snapshot();
      const { app, fetchReviews } = appFor(B);

      const res = await request(app).post(runsUrl(targetA.id)).expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
      expectNoTargetALeak(res.body, targetA.id);
      expect(fetchReviews).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    });

    it("answers another user's real target exactly like a target that doesn't exist", async () => {
      const targetA = await createTarget(A, A_NAME, A_SOURCE);
      const { app } = appFor(B);

      const real = await request(app).post(runsUrl(targetA.id)).expect(404);
      const unknown = await request(app).post(runsUrl(randomUUID())).expect(404);

      expect(real.body.error.code).toBe(unknown.body.error.code);
      expect(real.body.error.message).toBe(unknown.body.error.message);
    });

    it("rejects a body that names another user's target or owner, and creates no run", async () => {
      const targetA = await createTarget(A, A_NAME, A_SOURCE);
      const targetB = await createTarget(B, B_NAME, B_SOURCE);
      const userA = await users.findOrCreate(A);
      const { app, fetchReviews } = appFor(B);

      const res = await request(app)
        .post(runsUrl(targetB.id))
        .send({ targetId: targetA.id, ownerId: userA.id })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await testPrisma.ingestionRun.count()).toBe(0);
      expect(fetchReviews).not.toHaveBeenCalled();
    });
  });

  // These need the Review model and review endpoints from S1-022. Fill them in when it lands.
  describe('reviews', () => {
    it.todo("returns 404 when User B reads User A's target reviews, with no review data leaked");
    it.todo("creates no Review rows under User A's target when User B attempts ingestion");
    it.todo("never returns Target A's reviews when reading Target B's reviews");
  });
});
