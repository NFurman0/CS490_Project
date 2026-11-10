import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import type {
  FetchReviewsResult,
  ReviewSource,
} from '../../src/modules/ingestion/review-source.js';
import { createIngestionRunsRepository } from '../../src/modules/ingestion/ingestion-runs.repository.js';
import {
  createIngestionRouter,
  INGESTION_RUNS_PATH,
} from '../../src/modules/ingestion/ingestion.routes.js';
import { createIngestionService } from '../../src/modules/ingestion/ingestion.service.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createTestApp } from '../helpers/test-app.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

const users = createUsersRepository(testPrisma);
const targets = createTargetsRepository(testPrisma);
const SOURCE_URL = 'https://maps.google.com/?cid=123456';

const succeeded: FetchReviewsResult = {
  ok: true,
  place: { title: "Joe's Pizza", address: null, totalReviews: 2 },
  reviews: [1, 2].map((n) => ({
    sourceReviewId: `r${n}`,
    text: `Review ${n}`,
    rating: 4,
    reviewerName: null,
    publishedAt: null,
    reviewUrl: null,
    metadata: {},
  })),
};

/** The app as one Clerk user sees it, with a fake review source (never SerpApi). */
function appFor(clerkUserId: string | null, result: FetchReviewsResult = succeeded) {
  const fetchReviews = vi.fn<ReviewSource['fetchReviews']>(async () => result);
  const service = createIngestionService({
    targets,
    runs: createIngestionRunsRepository(testPrisma),
    reviewSource: { fetchReviews },
    maxReviewsPerRun: 50,
    logger: createLogger('silent'),
  });
  const app = createTestApp({
    as: clerkUserId,
    users,
    extraRouters: [{ path: INGESTION_RUNS_PATH, router: createIngestionRouter(service) }],
  });
  return { app, fetchReviews };
}

const runsUrl = (targetId: string) => `/api/analysis-targets/${targetId}/ingestion-runs`;

async function targetOwnedBy(clerkUserId: string) {
  const owner = await users.findOrCreate(clerkUserId);
  return targets.create(owner.id, {
    name: "Joe's Pizza",
    platform: 'GOOGLE_MAPS',
    sourceUrl: SOURCE_URL,
  });
}

describe.skipIf(!hasTestDatabase)('POST /api/analysis-targets/:targetId/ingestion-runs', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('rejects a signed-out request with 401, no run, and no source call', async () => {
    const target = await targetOwnedBy('clerk_a');
    const { app, fetchReviews } = appFor(null);

    const res = await request(app).post(runsUrl(target.id)).expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(await testPrisma.ingestionRun.count()).toBe(0);
    expect(fetchReviews).not.toHaveBeenCalled();
  });

  it("starts a run for the owner's target and records the outcome", async () => {
    const target = await targetOwnedBy('clerk_a');
    const { app, fetchReviews } = appFor('clerk_a');

    const res = await request(app).post(runsUrl(target.id)).expect(201);

    expect(fetchReviews).toHaveBeenCalledWith({ sourceUrl: SOURCE_URL, maxReviews: 50 });
    expect(res.body.data).toMatchObject({
      targetId: target.id,
      status: 'succeeded',
      errorCode: null,
      reviewCount: 2,
      startedAt: expect.any(String),
      completedAt: expect.any(String),
    });
    const saved = await testPrisma.ingestionRun.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(saved).toMatchObject({ targetId: target.id, status: 'SUCCEEDED', reviewCount: 2 });
  });

  it('counts only normalized reviews in the recorded run', async () => {
    // Inspect both the HTTP response and the persisted IngestionRun. No Review
    // rows exist yet: S1-022 will save them; this tests the recorded count.
    const target = await targetOwnedBy('clerk_a');
    if (!succeeded.ok) throw new Error('expected fixture reviews');
    const { app } = appFor('clerk_a', {
      ...succeeded,
      reviews: [succeeded.reviews[0]!, { ...succeeded.reviews[1]!, text: null }],
    });

    const res = await request(app).post(runsUrl(target.id)).expect(201);

    expect(res.body.data).toMatchObject({ status: 'succeeded', errorCode: null, reviewCount: 1 });
    const saved = await testPrisma.ingestionRun.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(saved).toMatchObject({ status: 'SUCCEEDED', reviewCount: 1 });
  });

  it('records SOURCE_NO_REVIEWS when all fetched reviews fail normalization', async () => {
    // A valid request still creates a run (HTTP 201), but the run must fail
    // instead of claiming success merely because the source returned records.
    const target = await targetOwnedBy('clerk_a');
    if (!succeeded.ok) throw new Error('expected fixture reviews');
    const { app } = appFor('clerk_a', {
      ...succeeded,
      reviews: succeeded.reviews.map((review) => ({ ...review, text: null })),
    });

    const res = await request(app).post(runsUrl(target.id)).expect(201);

    expect(res.body.data).toMatchObject({
      status: 'failed',
      errorCode: 'SOURCE_NO_REVIEWS',
      reviewCount: 0,
    });
    const saved = await testPrisma.ingestionRun.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(saved).toMatchObject({
      status: 'FAILED',
      errorCode: 'SOURCE_NO_REVIEWS',
      reviewCount: 0,
    });
  });

  it("returns 404 for another user's target before creating a run or calling the source", async () => {
    const target = await targetOwnedBy('clerk_a');
    const { app, fetchReviews } = appFor('clerk_b');

    const res = await request(app).post(runsUrl(target.id)).expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain(SOURCE_URL);
    expect(JSON.stringify(res.body)).not.toContain("Joe's Pizza");
    expect(await testPrisma.ingestionRun.count()).toBe(0);
    expect(fetchReviews).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown target ID', () => randomUUID()],
    ['a target ID that is not a UUID', () => 'not-a-uuid'],
  ])('returns 404 for %s', async (_label, targetId) => {
    await targetOwnedBy('clerk_a');
    const { app, fetchReviews } = appFor('clerk_a');

    const res = await request(app).post(runsUrl(targetId())).expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await testPrisma.ingestionRun.count()).toBe(0);
    expect(fetchReviews).not.toHaveBeenCalled();
  });

  it('rejects a body with ownership fields and creates no run', async () => {
    const target = await targetOwnedBy('clerk_a');
    const { app, fetchReviews } = appFor('clerk_a');

    const res = await request(app)
      .post(runsUrl(target.id))
      .send({ ownerId: randomUUID() })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await testPrisma.ingestionRun.count()).toBe(0);
    expect(fetchReviews).not.toHaveBeenCalled();
  });

  it('records a provider failure as a failed run, not an HTTP error', async () => {
    const target = await targetOwnedBy('clerk_a');
    const { app } = appFor('clerk_a', { ok: false, errorCode: 'PROVIDER_QUOTA_EXHAUSTED' });

    const res = await request(app).post(runsUrl(target.id)).expect(201);

    expect(res.body.data).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_QUOTA_EXHAUSTED',
      reviewCount: 0,
    });
    const saved = await testPrisma.ingestionRun.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(saved).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_QUOTA_EXHAUSTED' });
  });
});
