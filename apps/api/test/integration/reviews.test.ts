import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewsResponseSchema } from '@reviewlens/shared';
import { createLogger } from '../../src/lib/logger.js';
import { createIngestionRunsRepository } from '../../src/modules/ingestion/ingestion-runs.repository.js';
import {
  createIngestionRouter,
  INGESTION_RUNS_PATH,
} from '../../src/modules/ingestion/ingestion.routes.js';
import { createIngestionService } from '../../src/modules/ingestion/ingestion.service.js';
import type {
  FetchReviewsResult,
  RawReview,
  ReviewSource,
} from '../../src/modules/ingestion/review-source.js';
import { createReviewsRepository } from '../../src/modules/reviews/reviews.repository.js';
import { createReviewsRouter, REVIEWS_PATH } from '../../src/modules/reviews/reviews.routes.js';
import { createReviewsService } from '../../src/modules/reviews/reviews.service.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createTestApp } from '../helpers/test-app.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

const users = createUsersRepository(testPrisma);
const targets = createTargetsRepository(testPrisma);
const reviews = createReviewsRepository(testPrisma);
const sourceUrl = 'https://maps.google.com/?cid=123456';
const review = (text = '  Great food  '): RawReview => ({
  sourceReviewId: '  source-42  ',
  text,
  rating: 4.5,
  reviewerName: '  Alex  ',
  publishedAt: '2026-11-08T12:00:00+02:00',
  reviewUrl: '  https://example.com/review/42  ',
  metadata: { likes: 2, nested: { localGuide: true } },
});
const success = (
  batch: RawReview[] = [review()],
  stoppedEarly?: 'PROVIDER_TIMEOUT',
): FetchReviewsResult => ({
  ok: true,
  place: { title: null, address: null, totalReviews: null },
  reviews: batch,
  ...(stoppedEarly ? { stoppedEarly } : {}),
});

function appFor(as: string | null, result: FetchReviewsResult = success(), save = reviews) {
  // Replace Clerk and SerpApi in tests, but leave the repository connected to
  // PostgreSQL. Response assertions alone would not prove a row was saved.
  const fetchReviews = vi.fn<ReviewSource['fetchReviews']>(async () => result);
  const service = createIngestionService({
    targets,
    runs: createIngestionRunsRepository(testPrisma),
    reviews: save,
    reviewSource: { fetchReviews },
    maxReviewsPerRun: 50,
    logger: createLogger('silent'),
  });
  return {
    app: createTestApp({
      as,
      users,
      extraRouters: [
        { path: INGESTION_RUNS_PATH, router: createIngestionRouter(service) },
        { path: REVIEWS_PATH, router: createReviewsRouter(createReviewsService(targets, reviews)) },
      ],
    }),
    fetchReviews,
  };
}
const getUrl = (id: string) => `/api/analysis-targets/${id}/reviews`;
const postUrl = (id: string) => `/api/analysis-targets/${id}/ingestion-runs`;
async function targetFor(as: string) {
  const owner = await users.findOrCreate(as);
  return targets.create(owner.id, { name: 'Owned target', platform: 'GOOGLE_MAPS', sourceUrl });
}

describe.skipIf(!hasTestDatabase)('persisted owned reviews (PostgreSQL)', () => {
  // resetDatabase checks the actual connected DB name before deleting rows.
  // If the test DB is not configured, these tests skip rather than touch dev data.
  beforeEach(resetDatabase);
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('inserts normalized text, fractional rating, optionals and target association; GET reads them back', async () => {
    const target = await targetFor('clerk_a');
    const { app } = appFor('clerk_a');
    const run = await request(app).post(postUrl(target.id)).expect(201);
    // Inspect the real row as well as the GET result: these are two separate
    // places where a source value could be changed or accidentally dropped.
    const saved = await testPrisma.review.findMany({ where: { targetId: target.id } });
    expect(run.body.data).toMatchObject({ status: 'succeeded', reviewCount: 1 });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      targetId: target.id,
      text: 'Great food',
      rating: 4.5,
      sourceReviewId: 'source-42',
      reviewerName: 'Alex',
      publishedAt: '2026-11-08T12:00:00+02:00',
      reviewUrl: 'https://example.com/review/42',
      metadata: { likes: 2, nested: { localGuide: true } },
    });
    const response = await request(app).get(getUrl(target.id)).expect(200);
    const parsed = reviewsResponseSchema.parse(response.body);
    expect(parsed.data).toMatchObject([
      {
        id: saved[0]!.id,
        targetId: target.id,
        text: 'Great food',
        rating: 4.5,
        publishedAt: '2026-11-08T12:00:00+02:00',
        metadata: { likes: 2, nested: { localGuide: true } },
      },
    ]);
  });

  it('preserves a date-only publishedAt in the saved row and owned GET response', async () => {
    // A timestamp conversion could turn 2026-11-08 into midnight UTC; the
    // agreed mapping keeps this source string exactly as it was normalized.
    const target = await targetFor('clerk_a');
    const { app } = appFor('clerk_a', success([{ ...review(), publishedAt: '2026-11-08' }]));

    const run = await request(app).post(postUrl(target.id)).expect(201);
    expect(run.body.data).toMatchObject({ status: 'succeeded', reviewCount: 1 });

    const saved = await testPrisma.review.findMany({ where: { targetId: target.id } });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.publishedAt).toBe('2026-11-08');

    const response = await request(app).get(getUrl(target.id)).expect(200);
    const parsed = reviewsResponseSchema.parse(response.body);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]).toMatchObject({
      id: saved[0]!.id,
      targetId: target.id,
      publishedAt: '2026-11-08',
    });
  });

  it('keeps valid neighbors, missing optionals, and counts only inserted rows', async () => {
    const target = await targetFor('clerk_a');
    const minimal = {
      ...review('  Second  '),
      sourceReviewId: null,
      reviewerName: null,
      publishedAt: null,
      reviewUrl: null,
      metadata: {},
    };
    const { app } = appFor(
      'clerk_a',
      success([review(), review('  '), minimal, { ...review(), rating: 9 }]),
    );
    const run = await request(app).post(postUrl(target.id)).expect(201);
    expect(run.body.data.reviewCount).toBe(2);
    expect(
      (await testPrisma.ingestionRun.findFirstOrThrow({ where: { id: run.body.data.id } }))
        .reviewCount,
    ).toBe(2);
    const rows = await testPrisma.review.findMany({ where: { targetId: target.id } });
    expect(rows.map((row) => row.text).sort()).toEqual(['Great food', 'Second']);
    expect(rows.find((row) => row.text === 'Second')).toMatchObject({
      targetId: target.id,
      sourceReviewId: null,
      reviewerName: null,
      publishedAt: null,
      reviewUrl: null,
      metadata: {},
    });
  });

  it('isolates two targets of the same owner and returns [] for an empty target', async () => {
    // Different users returning 404 is not enough: this catches a query that
    // filters by owner but forgets to filter by the selected target ID.
    const a = await targetFor('clerk_a');
    const b = await targetFor('clerk_a');
    const empty = await targetFor('clerk_a');
    const { app: appA } = appFor('clerk_a', success([review('A only')]));
    await request(appA).post(postUrl(a.id)).expect(201);
    const { app: appB } = appFor('clerk_a', success([review('B only')]));
    await request(appB).post(postUrl(b.id)).expect(201);
    expect(
      (await request(appA).get(getUrl(a.id)).expect(200)).body.data.map(
        (r: { text: string }) => r.text,
      ),
    ).toEqual(['A only']);
    expect(
      (await request(appA).get(getUrl(b.id)).expect(200)).body.data.map(
        (r: { text: string }) => r.text,
      ),
    ).toEqual(['B only']);
    expect((await request(appA).get(getUrl(empty.id)).expect(200)).body).toEqual({ data: [] });
    expect(await testPrisma.review.count()).toBe(2);
  });

  it('returns the same 404 for foreign, missing and malformed IDs without leaking reviews', async () => {
    const a = await targetFor('clerk_a');
    await request(appFor('clerk_a').app).post(postUrl(a.id)).expect(201);
    const app = appFor('clerk_b').app;
    const bodies = [];
    for (const id of [a.id, randomUUID(), 'bad-id']) {
      const res = await request(app).get(getUrl(id)).expect(404);
      bodies.push({ code: res.body.error.code, message: res.body.error.message });
      expect(JSON.stringify(res.body)).not.toContain('Great food');
      expect(JSON.stringify(res.body)).not.toContain('source-42');
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(await testPrisma.review.count()).toBe(1);
  });

  it('rejects anonymous GET and POST, and foreign POST before source, run, or review writes', async () => {
    const a = await targetFor('clerk_a');
    await request(appFor('clerk_a').app).post(postUrl(a.id)).expect(201);
    const previous = await testPrisma.review.findMany();
    const { app: anonymous, fetchReviews: anonSource } = appFor(null);
    const { app: foreign, fetchReviews: foreignSource } = appFor('clerk_b');
    const anonymousRead = await request(anonymous).get(getUrl(a.id)).expect(401);
    expect(anonymousRead.body.error.code).toBe('UNAUTHENTICATED');
    expect(JSON.stringify(anonymousRead.body)).not.toContain('Great food');
    expect(JSON.stringify(anonymousRead.body)).not.toContain(previous[0]!.id);
    expect((await request(anonymous).post(postUrl(a.id)).expect(401)).body.error.code).toBe(
      'UNAUTHENTICATED',
    );
    const denied = await request(foreign).post(postUrl(a.id)).expect(404);
    expect(denied.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(denied.body)).not.toContain('Great food');
    expect(anonSource).not.toHaveBeenCalled();
    expect(foreignSource).not.toHaveBeenCalled();
    expect(await testPrisma.ingestionRun.count()).toBe(1);
    expect(await testPrisma.review.findMany()).toEqual(previous);
  });

  it.each([
    [
      'provider failure',
      { ok: false, errorCode: 'PROVIDER_TIMEOUT' } as FetchReviewsResult,
      'PROVIDER_TIMEOUT',
    ],
    ['all-invalid batch', success([{ ...review(), text: null }]), 'SOURCE_NO_REVIEWS'],
  ])('%s records FAILED/0 and preserves prior reviews', async (_label, result, code) => {
    const target = await targetFor('clerk_a');
    await request(appFor('clerk_a').app).post(postUrl(target.id)).expect(201);
    const prior = await testPrisma.review.findMany();
    const failed = await request(appFor('clerk_a', result).app)
      .post(postUrl(target.id))
      .expect(201);
    expect(failed.body.data).toMatchObject({ status: 'failed', reviewCount: 0, errorCode: code });
    expect(
      await testPrisma.ingestionRun.findFirstOrThrow({ where: { id: failed.body.data.id } }),
    ).toMatchObject({ status: 'FAILED', reviewCount: 0, errorCode: code });
    expect(await testPrisma.review.findMany()).toEqual(prior);
  });

  it('keeps saved partial pages and their stoppedEarly code', async () => {
    const target = await targetFor('clerk_a');
    const run = await request(appFor('clerk_a', success([review()], 'PROVIDER_TIMEOUT')).app)
      .post(postUrl(target.id))
      .expect(201);
    expect(run.body.data).toMatchObject({
      status: 'succeeded',
      errorCode: 'PROVIDER_TIMEOUT',
      reviewCount: 1,
    });
    expect(await testPrisma.review.count({ where: { targetId: target.id } })).toBe(1);
  });

  it('rolls back a multi-review batch if finishing the run fails, then records persistence failure', async () => {
    const target = await targetFor('clerk_a');
    await request(appFor('clerk_a').app).post(postUrl(target.id)).expect(201);
    const prior = await testPrisma.review.findMany();
    // Give the repository a nonexistent run ID after it inserts two reviews.
    // The transaction must undo both inserts before recording the real run as failed.
    const broken: typeof reviews = {
      ...reviews,
      saveBatchAndFinishRun: (ownerId, targetId, _runId, batch, stoppedEarly) =>
        reviews.saveBatchAndFinishRun(ownerId, targetId, randomUUID(), batch, stoppedEarly),
    };
    const res = await request(
      appFor('clerk_a', success([review('one'), review('two')]), broken).app,
    )
      .post(postUrl(target.id))
      .expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('Ingestion run could not be completed');
    expect(await testPrisma.review.findMany()).toEqual(prior);
    const latest = await testPrisma.ingestionRun.findFirstOrThrow({
      where: { targetId: target.id, errorCode: 'PERSISTENCE_ERROR' },
    });
    expect(latest).toMatchObject({
      status: 'FAILED',
      errorCode: 'PERSISTENCE_ERROR',
      reviewCount: 0,
    });
  });

  it('cascades child reviews on target deletion while leaving another target intact', async () => {
    // Prisma deletes only the parent here: the foreign key, not application
    // cleanup code, must remove its children and leave another target alone.
    const a = await targetFor('clerk_a');
    const b = await targetFor('clerk_a');
    const app = appFor('clerk_a').app;
    await request(app).post(postUrl(a.id)).expect(201);
    await request(app).post(postUrl(b.id)).expect(201);
    await testPrisma.analysisTarget.delete({ where: { id: a.id } });
    expect(await testPrisma.review.count({ where: { targetId: a.id } })).toBe(0);
    expect(await testPrisma.review.count({ where: { targetId: b.id } })).toBe(1);
  });
});
