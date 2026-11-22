import { randomUUID } from 'node:crypto';
import type { AnalysisTarget, IngestionRun, Review } from '@prisma/client';
import { reviewsResponseSchema } from '@reviewlens/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import {
  createIngestionRunsRepository,
  type FinishedRun,
  type IngestionRunsRepository,
} from '../../src/modules/ingestion/ingestion-runs.repository.js';
import {
  createIngestionRouter,
  INGESTION_RUNS_PATH,
} from '../../src/modules/ingestion/ingestion.routes.js';
import { createIngestionService } from '../../src/modules/ingestion/ingestion.service.js';
import type { NormalizedReview } from '../../src/modules/ingestion/review-normalizer.js';
import type {
  FetchReviewsResult,
  RawReview,
  ReviewSource,
} from '../../src/modules/ingestion/review-source.js';
import { createQaService } from '../../src/modules/qa/qa.service.js';
import {
  createReviewsRepository,
  type ReviewsRepository,
} from '../../src/modules/reviews/reviews.repository.js';
import { createReviewsRouter, REVIEWS_PATH } from '../../src/modules/reviews/reviews.routes.js';
import { createReviewsService } from '../../src/modules/reviews/reviews.service.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createTargetsRouter } from '../../src/modules/targets/targets.routes.js';
import {
  createTargetsService,
  type TargetsRepository,
} from '../../src/modules/targets/targets.service.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createFakeQaModel } from '../helpers/fake-qa-model.js';
import {
  evaluateScopeGuardSuite,
  loadScopeGuardEvaluationSet,
} from '../helpers/scope-guard-evaluator.js';
import { createTestApp } from '../helpers/test-app.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

/**
 * Critical Sprint 2 integration tests (S2-002).
 *
 * Covers the cross-module boundaries where independently correct components
 * could still fail when combined:
 * 1. Loading persisted reviews for an AnalysisTarget.
 * 2. Computing an ingestion summary from persisted data.
 * 3. Passing the correct review dataset into the Q&A service.
 * 4. Applying authenticated ownership before review retrieval.
 * 5. Changing the active target and retrieving different data.
 */

interface PersistedSummary {
  reviewCount: number;
  averageRating: number | null;
  ratingCounts: Record<number, number>;
}

/** Derives review count and rating summary strictly from persisted review rows. */
function summarizePersistedReviews(rows: readonly Pick<Review, 'rating'>[]): PersistedSummary {
  const ratingCounts: Record<number, number> = {};
  if (rows.length === 0) {
    return { reviewCount: 0, averageRating: null, ratingCounts };
  }
  let total = 0;
  for (const row of rows) {
    total += row.rating;
    ratingCounts[row.rating] = (ratingCounts[row.rating] ?? 0) + 1;
  }
  return {
    reviewCount: rows.length,
    averageRating: Number((total / rows.length).toFixed(2)),
    ratingCounts,
  };
}

function makeRawReview(overrides: Partial<RawReview> = {}): RawReview {
  return {
    sourceReviewId: `src-${randomUUID().slice(0, 8)}`,
    text: 'Consistent quality and fast service.',
    rating: 4,
    reviewerName: 'Jordan',
    publishedAt: '2026-11-10',
    reviewUrl: 'https://maps.google.com/review/123',
    metadata: { internalToken: 'provider-only-metadata', likes: 3 },
    ...overrides,
  };
}

function okFetch(reviews: RawReview[], stoppedEarly?: 'PROVIDER_TIMEOUT'): FetchReviewsResult {
  return {
    ok: true,
    place: { title: 'Test Place', address: null, totalReviews: reviews.length },
    reviews,
    ...(stoppedEarly ? { stoppedEarly } : {}),
  };
}

/**
 * Stateful in-memory persistence adapter that mirrors the Prisma repository
 * contracts (owner-scoped queries, transactional batch save + run finish,
 * cascade deletion) so boundary tests always execute in `npm test`, even when
 * PostgreSQL is not running locally.
 */
function createInMemoryPersistence() {
  const targetRows = new Map<string, AnalysisTarget>();
  const runRows = new Map<string, IngestionRun>();
  const reviewRows: Review[] = [];
  let clock = 0;
  const nextDate = () => new Date(Date.UTC(2026, 10, 18, 12, 0, ++clock));

  const targets: TargetsRepository = {
    async create(ownerId, input) {
      const target: AnalysisTarget = {
        id: randomUUID(),
        ownerId,
        name: input.name,
        platform: input.platform,
        sourceUrl: input.sourceUrl,
        createdAt: nextDate(),
      };
      targetRows.set(target.id, target);
      return target;
    },
    async findById(ownerId, targetId) {
      const found = targetRows.get(targetId);
      return found && found.ownerId === ownerId ? found : null;
    },
    async deleteById(ownerId, targetId) {
      const found = targetRows.get(targetId);
      if (!found || found.ownerId !== ownerId) return { count: 0 };
      targetRows.delete(targetId);
      for (let i = reviewRows.length - 1; i >= 0; i -= 1) {
        if (reviewRows[i]!.targetId === targetId) reviewRows.splice(i, 1);
      }
      for (const [id, run] of runRows.entries()) {
        if (run.targetId === targetId) runRows.delete(id);
      }
      return { count: 1 };
    },
    async findMany(ownerId, take) {
      const owned = [...targetRows.values()]
        .filter((t) => t.ownerId === ownerId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return take === undefined ? owned : owned.slice(0, take);
    },
  };

  const runs: IngestionRunsRepository = {
    async start(targetId) {
      const run: IngestionRun = {
        id: randomUUID(),
        targetId,
        status: 'RUNNING',
        errorCode: null,
        reviewCount: 0,
        startedAt: nextDate(),
        completedAt: null,
      };
      runRows.set(run.id, run);
      return run;
    },
    async finish(runId, outcome: FinishedRun) {
      const existing = runRows.get(runId);
      if (!existing) throw new Error('Run not found');
      const finished: IngestionRun = {
        ...existing,
        status: outcome.status,
        errorCode: outcome.errorCode,
        reviewCount: outcome.reviewCount,
        completedAt: nextDate(),
      };
      runRows.set(runId, finished);
      return finished;
    },
    async findLatest(targetId) {
      const matching = [...runRows.values()]
        .filter((r) => r.targetId === targetId)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id));
      return matching[0] ?? null;
    },
  };

  const reviews: ReviewsRepository = {
    async findByTarget(ownerId, targetId) {
      const target = targetRows.get(targetId);
      if (!target || target.ownerId !== ownerId) return [];
      return reviewRows
        .filter((r) => r.targetId === targetId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },
    async saveBatchAndFinishRun(
      ownerId,
      targetId,
      runId,
      batch: readonly NormalizedReview[],
      stoppedEarly,
    ) {
      const target = targetRows.get(targetId);
      if (!target || target.ownerId !== ownerId) {
        throw new Error('Owned target was removed before reviews could be saved.');
      }
      const existingRun = runRows.get(runId);
      if (!existingRun || existingRun.targetId !== targetId || existingRun.status !== 'RUNNING') {
        throw new Error('Ingestion run could not be completed.');
      }
      for (const item of batch) {
        reviewRows.push({
          id: randomUUID(),
          targetId: target.id,
          sourceReviewId: item.sourceReviewId,
          text: item.text,
          rating: item.rating,
          reviewerName: item.reviewerName,
          publishedAt: item.publishedAt,
          reviewUrl: item.reviewUrl,
          metadata: JSON.parse(JSON.stringify(item.metadata)),
          createdAt: nextDate(),
        });
      }
      const finished: IngestionRun = {
        ...existingRun,
        status: 'SUCCEEDED',
        errorCode: stoppedEarly,
        reviewCount: batch.length,
        completedAt: nextDate(),
      };
      runRows.set(runId, finished);
      return finished;
    },
  };

  return {
    targets,
    runs,
    reviews,
    removeReviewById(reviewId: string) {
      const index = reviewRows.findIndex((r) => r.id === reviewId);
      if (index !== -1) reviewRows.splice(index, 1);
    },
  };
}

describe('Sprint 2 critical service boundaries (in-memory persistence)', () => {
  const OWNER_A = randomUUID();
  const OWNER_B = randomUUID();
  const SOURCE_A = 'https://maps.google.com/?cid=100001';
  const SOURCE_B = 'https://maps.google.com/?cid=200002';
  const SOURCE_C = 'https://maps.google.com/?cid=300003';

  function buildStack(responsesByUrl: Map<string, FetchReviewsResult>) {
    const store = createInMemoryPersistence();
    const logger = createLogger('silent');
    const fetchReviews = vi.fn<ReviewSource['fetchReviews']>(async ({ sourceUrl }) => {
      return (
        responsesByUrl.get(sourceUrl) ?? {
          ok: false,
          errorCode: 'SOURCE_UNRESOLVABLE',
        }
      );
    });
    const targetsService = createTargetsService({
      repository: store.targets,
      validateSourceUrl: async () => true,
    });
    const ingestionService = createIngestionService({
      targets: store.targets,
      runs: store.runs,
      reviews: store.reviews,
      reviewSource: { fetchReviews },
      maxReviewsPerRun: 50,
      logger,
    });
    const reviewsService = createReviewsService(store.targets, store.reviews);
    const fakeModel = createFakeQaModel();
    const qaService = createQaService({
      targets: store.targets,
      reviews: store.reviews,
      model: fakeModel.model,
      logger,
    });

    return {
      store,
      fetchReviews,
      targetsService,
      ingestionService,
      reviewsService,
      qaService,
      fakeModel,
    };
  }

  it('loads normalized persisted reviews, aligns summary metrics, and passes only sanitized context to Q&A', async () => {
    const responses = new Map<string, FetchReviewsResult>([
      [
        SOURCE_A,
        okFetch([
          makeRawReview({
            text: '  Cardamom latte and quiet patio seating.  ',
            rating: 5,
            reviewerName: '  Maya  ',
            publishedAt: '2026-11-11',
            metadata: { secretProviderKey: 'must-not-cross-model-boundary' },
          }),
          makeRawReview({
            text: '   ', // skipped: empty text
            rating: 1,
          }),
          makeRawReview({
            text: 'Invalid rating should be skipped.',
            rating: 9, // skipped: out-of-range rating
          }),
          makeRawReview({
            text: '  Pastries sell out quickly after noon.  ',
            rating: 4,
            reviewerName: null,
            publishedAt: null,
          }),
        ]),
      ],
    ]);

    const { targetsService, ingestionService, reviewsService, qaService, fakeModel } =
      buildStack(responses);

    const target = await targetsService.create(OWNER_A, {
      name: 'Harbor Coffee Roasters',
      sourceUrl: SOURCE_A,
    });

    const run = await ingestionService.startIngestion(OWNER_A, target.id);
    const latestRun = await ingestionService.latestRun(OWNER_A, target.id);
    const persisted = await reviewsService.list(OWNER_A, target.id);
    const summary = summarizePersistedReviews(persisted);

    // Boundary 1 & 2: skipped records never persist and never inflate summary metrics.
    expect(run.status).toBe('SUCCEEDED');
    expect(latestRun?.id).toBe(run.id);
    expect(latestRun?.reviewCount).toBe(2);
    expect(persisted).toHaveLength(2);
    expect(summary).toEqual({
      reviewCount: 2,
      averageRating: 4.5,
      ratingCounts: { 4: 1, 5: 1 },
    });

    // Boundary 3: Q&A receives the exact persisted reviews without internal/provider fields.
    fakeModel.respondWith({
      outcome: 'grounded_answer',
      answer:
        'Customers praise the cardamom latte and quiet patio, noting pastries sell out early.',
    });
    const qaResult = await qaService.ask(OWNER_A, target.id, 'What do customers like?');

    expect(qaResult.reviewCount).toBe(summary.reviewCount);
    expect(qaResult.outcome).toBe('grounded_answer');
    expect(fakeModel.suppliedReviewIds()).toEqual(persisted.map((r) => r.id));
    expect(fakeModel.lastRequest().systemPrompt).toContain('Harbor Coffee Roasters');
    expect(fakeModel.lastRequest().systemPrompt).toContain('Google Maps');

    const sentPayload = fakeModel.everythingSent();
    expect(sentPayload).toContain('Cardamom latte and quiet patio seating.');
    expect(sentPayload).not.toContain('Invalid rating should be skipped.');
    expect(sentPayload).not.toContain('must-not-cross-model-boundary');
    expect(sentPayload).not.toContain(OWNER_A);
    expect(sentPayload).not.toContain(SOURCE_A);
    expect(Object.keys(fakeModel.lastRequest().reviews[0]!).sort()).toEqual([
      'id',
      'publishedAt',
      'rating',
      'reviewerName',
      'text',
    ]);
  });

  it('recomputes persisted summary and Q&A dataset when persisted reviews change or re-ingestion fails', async () => {
    const responses = new Map<string, FetchReviewsResult>([
      [
        SOURCE_A,
        okFetch([
          makeRawReview({ text: 'Fast Wi-Fi and clean tables.', rating: 5 }),
          makeRawReview({ text: 'Loud music in the afternoon.', rating: 3 }),
        ]),
      ],
    ]);

    const { store, targetsService, ingestionService, reviewsService, qaService, fakeModel } =
      buildStack(responses);

    const target = await targetsService.create(OWNER_A, {
      name: 'Harbor Coffee Roasters',
      sourceUrl: SOURCE_A,
    });

    await ingestionService.startIngestion(OWNER_A, target.id);
    const initialReviews = await reviewsService.list(OWNER_A, target.id);
    expect(summarizePersistedReviews(initialReviews)).toEqual({
      reviewCount: 2,
      averageRating: 4,
      ratingCounts: { 3: 1, 5: 1 },
    });

    // Removing a persisted review immediately updates both the derived summary and Q&A context.
    store.removeReviewById(initialReviews[1]!.id);
    const afterRemoval = await reviewsService.list(OWNER_A, target.id);
    expect(summarizePersistedReviews(afterRemoval)).toEqual({
      reviewCount: 1,
      averageRating: 5,
      ratingCounts: { 5: 1 },
    });

    await qaService.ask(OWNER_A, target.id, 'Any complaints about noise?');
    expect(fakeModel.suppliedReviewIds()).toEqual([initialReviews[0]!.id]);
    expect(fakeModel.everythingSent()).not.toContain('Loud music in the afternoon.');

    // A subsequent failed ingestion run records FAILED/0 while preserving existing persisted reviews.
    responses.set(SOURCE_A, { ok: false, errorCode: 'PROVIDER_QUOTA_EXHAUSTED' });
    const failedRun = await ingestionService.startIngestion(OWNER_A, target.id);
    expect(failedRun).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_QUOTA_EXHAUSTED',
      reviewCount: 0,
    });

    const stillPersisted = await reviewsService.list(OWNER_A, target.id);
    expect(stillPersisted).toHaveLength(1);
    const answerAfterFailure = await qaService.ask(OWNER_A, target.id, 'How is the Wi-Fi?');
    expect(answerAfterFailure.reviewCount).toBe(1);
    expect(fakeModel.suppliedReviewIds()).toEqual([initialReviews[0]!.id]);
  });

  it('enforces authenticated ownership before review retrieval, ingestion, and Q&A across two users', async () => {
    const SECRET_PHRASE = 'velvet-turquoise-espresso-machine';
    const responses = new Map<string, FetchReviewsResult>([
      [SOURCE_A, okFetch([makeRawReview({ text: `Loved the ${SECRET_PHRASE}.`, rating: 5 })])],
      [SOURCE_B, okFetch([makeRawReview({ text: 'Quick oil change and fair price.', rating: 4 })])],
    ]);

    const { fetchReviews, targetsService, ingestionService, reviewsService, qaService, fakeModel } =
      buildStack(responses);

    const targetA = await targetsService.create(OWNER_A, {
      name: 'Harbor Coffee Roasters',
      sourceUrl: SOURCE_A,
    });
    const targetB = await targetsService.create(OWNER_B, {
      name: 'Metro Auto Repair',
      sourceUrl: SOURCE_B,
    });

    await ingestionService.startIngestion(OWNER_A, targetA.id);
    await ingestionService.startIngestion(OWNER_B, targetB.id);
    const callsBeforeCrossUser = fetchReviews.mock.calls.length;

    // Boundary 4: User B cannot inspect, ingest, or query User A's target.
    await expect(targetsService.getOwned(OWNER_B, targetA.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(ingestionService.latestRun(OWNER_B, targetA.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(ingestionService.startIngestion(OWNER_B, targetA.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(reviewsService.list(OWNER_B, targetA.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      qaService.ask(OWNER_B, targetA.id, `Tell me about ${SECRET_PHRASE}`),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(fetchReviews.mock.calls.length).toBe(callsBeforeCrossUser);
    expect(fakeModel.requests).toHaveLength(0);

    // Asking on User B's own target never pulls User A's reviews into AI context.
    await qaService.ask(OWNER_B, targetB.id, `Do reviews mention ${SECRET_PHRASE}?`);
    expect(fakeModel.requests).toHaveLength(1);
    expect(JSON.stringify(fakeModel.lastRequest().reviews)).not.toContain(SECRET_PHRASE);
    expect(fakeModel.lastRequest().reviews.map((r) => r.text)).toEqual([
      'Quick oil change and fair price.',
    ]);
  });

  it('switches active targets cleanly across populated, secondary, and empty targets with no stale context', async () => {
    const PHRASE_A = 'cardamom-latte-patio';
    const PHRASE_B = 'ceramic-brake-pads';
    const PHRASE_A_NEW = 'oat-milk-cortado';

    const responses = new Map<string, FetchReviewsResult>([
      [
        SOURCE_A,
        okFetch([
          makeRawReview({ text: `Best ${PHRASE_A} in town.`, rating: 5 }),
          makeRawReview({ text: 'Friendly baristas.', rating: 4 }),
        ]),
      ],
      [SOURCE_B, okFetch([makeRawReview({ text: `Overcharged for ${PHRASE_B}.`, rating: 2 })])],
      [SOURCE_C, { ok: false, errorCode: 'SOURCE_NO_REVIEWS' }],
    ]);

    const { targetsService, ingestionService, reviewsService, qaService, fakeModel } =
      buildStack(responses);

    const targetA = await targetsService.create(OWNER_A, {
      name: 'Harbor Coffee Roasters',
      sourceUrl: SOURCE_A,
    });
    const targetB = await targetsService.create(OWNER_A, {
      name: 'Metro Auto Repair',
      sourceUrl: SOURCE_B,
    });
    const targetC = await targetsService.create(OWNER_A, {
      name: 'Empty Bakery',
      sourceUrl: SOURCE_C,
    });

    await ingestionService.startIngestion(OWNER_A, targetA.id);
    await ingestionService.startIngestion(OWNER_A, targetB.id);
    await ingestionService.startIngestion(OWNER_A, targetC.id);

    // Step 1: Active target = Target A
    const reviewsA = await reviewsService.list(OWNER_A, targetA.id);
    expect(summarizePersistedReviews(reviewsA)).toEqual({
      reviewCount: 2,
      averageRating: 4.5,
      ratingCounts: { 4: 1, 5: 1 },
    });
    await qaService.ask(OWNER_A, targetA.id, 'What stands out?');
    expect(JSON.stringify(fakeModel.requests[0])).toContain(PHRASE_A);
    expect(JSON.stringify(fakeModel.requests[0])).not.toContain(PHRASE_B);

    // Step 2: Switch active target -> Target B
    const reviewsB = await reviewsService.list(OWNER_A, targetB.id);
    expect(summarizePersistedReviews(reviewsB)).toEqual({
      reviewCount: 1,
      averageRating: 2,
      ratingCounts: { 2: 1 },
    });
    await qaService.ask(OWNER_A, targetB.id, 'What stands out?');
    expect(JSON.stringify(fakeModel.requests[1])).toContain(PHRASE_B);
    expect(JSON.stringify(fakeModel.requests[1])).not.toContain(PHRASE_A);
    expect(fakeModel.requests[1]!.systemPrompt).toContain('Metro Auto Repair');

    // Step 3: Switch active target -> Target C (no review data) must not reuse Target B context
    const reviewsC = await reviewsService.list(OWNER_A, targetC.id);
    expect(reviewsC).toEqual([]);
    const emptyAnswer = await qaService.ask(OWNER_A, targetC.id, 'What do customers like?');
    expect(emptyAnswer).toMatchObject({
      target: { id: targetC.id, name: 'Empty Bakery' },
      outcome: 'no_review_data',
      reviewCount: 0,
    });
    expect(fakeModel.requests).toHaveLength(2); // Model was not invoked for empty target

    // Step 4: Switch back to Target A after ingesting a new review -> sees fresh dataset
    responses.set(
      SOURCE_A,
      okFetch([makeRawReview({ text: `Try the ${PHRASE_A_NEW}.`, rating: 5 })]),
    );
    await ingestionService.startIngestion(OWNER_A, targetA.id);
    const updatedA = await qaService.ask(OWNER_A, targetA.id, 'Any drink recommendations?');
    expect(updatedA.reviewCount).toBe(3);
    expect(JSON.stringify(fakeModel.requests[2])).toContain(PHRASE_A_NEW);
    expect(JSON.stringify(fakeModel.requests[2])).not.toContain(PHRASE_B);
  });

  it('connects S2-004 scope-guard evaluation set through IngestionService and QaService deterministically', async () => {
    const evalSet = loadScopeGuardEvaluationSet();
    const responses = new Map<string, FetchReviewsResult>([
      [
        evalSet.target.sourceUrl,
        okFetch(
          evalSet.reviews.map((r) => ({
            sourceReviewId: r.sourceReviewId,
            text: r.text,
            rating: r.rating,
            reviewerName: r.reviewerName,
            publishedAt: r.publishedAt,
            reviewUrl: r.reviewUrl,
            metadata: r.metadata,
          })),
        ),
      ],
    ]);

    const { targetsService, ingestionService, qaService, fakeModel } = buildStack(responses);

    const target = await targetsService.create(OWNER_A, {
      name: evalSet.target.name,
      sourceUrl: evalSet.target.sourceUrl,
    });
    const run = await ingestionService.startIngestion(OWNER_A, target.id);
    expect(run.status).toBe('SUCCEEDED');
    expect(run.reviewCount).toBe(evalSet.reviews.length);

    const answersByCaseId = new Map<string, string>();
    for (const testCase of evalSet.cases) {
      fakeModel.respondWith({
        outcome: testCase.expectedOutcome,
        answer: testCase.samplePassingResponse,
      });
      const result = await qaService.ask(OWNER_A, target.id, testCase.question);
      expect(result.outcome).toBe(testCase.expectedOutcome);
      expect(result.reviewCount).toBe(evalSet.reviews.length);
      answersByCaseId.set(testCase.id, result.answer);
    }

    const evaluation = evaluateScopeGuardSuite(evalSet, (c) => answersByCaseId.get(c.id));
    expect(evaluation.allAcceptable).toBe(true);
    expect(evaluation.passedCases).toBe(evalSet.cases.length);
    expect(fakeModel.requests).toHaveLength(evalSet.cases.length);
    expect(fakeModel.lastRequest().systemPrompt).toContain(evalSet.target.name);
  });

  it('maps model provider failures and malformed responses to AI_SERVICE_UNAVAILABLE without leaking internals', async () => {
    const responses = new Map<string, FetchReviewsResult>([
      [SOURCE_A, okFetch([makeRawReview({ text: 'Great coffee.', rating: 5 })])],
    ]);
    const { targetsService, ingestionService, qaService, fakeModel } = buildStack(responses);

    const target = await targetsService.create(OWNER_A, {
      name: 'Harbor Coffee Roasters',
      sourceUrl: SOURCE_A,
    });
    await ingestionService.startIngestion(OWNER_A, target.id);

    fakeModel.failWith(new Error('upstream provider api key sk-secret-123 failed'));
    await expect(qaService.ask(OWNER_A, target.id, 'Summarize reviews')).rejects.toMatchObject({
      code: 'AI_SERVICE_UNAVAILABLE',
    });

    fakeModel.returnMalformed({ outcome: 'unknown_mode', answer: '' });
    await expect(qaService.ask(OWNER_A, target.id, 'Summarize reviews')).rejects.toMatchObject({
      code: 'AI_SERVICE_UNAVAILABLE',
    });
  });
});

describe.skipIf(!hasTestDatabase)(
  'Sprint 2 critical boundaries across HTTP routes, PostgreSQL, and Q&A',
  () => {
    const users = createUsersRepository(testPrisma);
    const targetsRepo = createTargetsRepository(testPrisma);
    const runsRepo = createIngestionRunsRepository(testPrisma);
    const reviewsRepo = createReviewsRepository(testPrisma);
    const logger = createLogger('silent');

    const SOURCE_A = 'https://maps.google.com/?cid=910001';
    const SOURCE_B = 'https://maps.google.com/?cid=920002';
    const SOURCE_EMPTY = 'https://maps.google.com/?cid=930003';

    beforeEach(async () => {
      await resetDatabase();
    });

    afterAll(async () => {
      await testPrisma.$disconnect();
    });

    function createIntegrationApp(
      clerkUserId: string | null,
      responsesByUrl: Map<string, FetchReviewsResult>,
    ) {
      const fetchReviews = vi.fn<ReviewSource['fetchReviews']>(async ({ sourceUrl }) => {
        return (
          responsesByUrl.get(sourceUrl) ?? {
            ok: false,
            errorCode: 'SOURCE_NO_REVIEWS',
          }
        );
      });
      const targetsService = createTargetsService({
        repository: targetsRepo,
        validateSourceUrl: async () => true,
      });
      const ingestionService = createIngestionService({
        targets: targetsRepo,
        runs: runsRepo,
        reviews: reviewsRepo,
        reviewSource: { fetchReviews },
        maxReviewsPerRun: 50,
        logger,
      });
      const reviewsService = createReviewsService(targetsRepo, reviewsRepo);
      const fakeModel = createFakeQaModel();
      const qaService = createQaService({
        targets: targetsRepo,
        reviews: reviewsRepo,
        model: fakeModel.model,
        logger,
      });

      const app = createTestApp({
        as: clerkUserId,
        users,
        extraRouters: [
          { path: '/analysis-targets', router: createTargetsRouter(targetsService) },
          { path: INGESTION_RUNS_PATH, router: createIngestionRouter(ingestionService) },
          { path: REVIEWS_PATH, router: createReviewsRouter(reviewsService) },
        ],
      });

      return { app, fetchReviews, qaService, fakeModel };
    }

    it('flows from HTTP target creation and ingestion through PostgreSQL into review retrieval, summary, and Q&A', async () => {
      const responses = new Map<string, FetchReviewsResult>([
        [
          SOURCE_A,
          okFetch([
            makeRawReview({
              text: '  Espresso shots are consistently balanced.  ',
              rating: 5,
              reviewerName: 'Elena',
              publishedAt: '2026-11-12',
              metadata: { providerSecret: 'strip-me-before-llm' },
            }),
            makeRawReview({ text: '   ', rating: 2 }), // invalid: skipped
            makeRawReview({
              text: '  Long weekend lines at the counter.  ',
              rating: 3.5,
              reviewerName: 'Marcus',
              publishedAt: '2026-11-13',
            }),
          ]),
        ],
      ]);

      const { app, qaService, fakeModel } = createIntegrationApp('clerk_s2_owner_a', responses);

      const created = await request(app)
        .post('/api/analysis-targets')
        .send({
          name: 'Copper Kettle Cafe',
          sourceUrl: SOURCE_A,
        })
        .expect(201);
      const targetId = created.body.data.id as string;

      const runRes = await request(app)
        .post(`/api/analysis-targets/${targetId}/ingestion-runs`)
        .expect(201);
      expect(runRes.body.data).toMatchObject({
        targetId,
        status: 'succeeded',
        reviewCount: 2,
      });

      const latestRes = await request(app)
        .get(`/api/analysis-targets/${targetId}/ingestion-runs/latest`)
        .expect(200);
      expect(latestRes.body.data.reviewCount).toBe(2);

      const reviewsRes = await request(app)
        .get(`/api/analysis-targets/${targetId}/reviews`)
        .expect(200);
      const parsedReviews = reviewsResponseSchema.parse(reviewsRes.body);
      expect(parsedReviews.data).toHaveLength(2);
      expect(summarizePersistedReviews(parsedReviews.data)).toEqual({
        reviewCount: 2,
        averageRating: 4.25,
        ratingCounts: { 3.5: 1, 5: 1 },
      });

      const owner = await users.findOrCreate('clerk_s2_owner_a');
      const qaResult = await qaService.ask(
        owner.id,
        targetId,
        'What do customers say about lines?',
      );
      expect(qaResult.reviewCount).toBe(2);
      expect(fakeModel.suppliedReviewIds().sort()).toEqual(
        parsedReviews.data.map((r) => r.id).sort(),
      );
      expect(fakeModel.lastRequest().systemPrompt).toContain('Copper Kettle Cafe');
      expect(fakeModel.everythingSent()).not.toContain('strip-me-before-llm');
      expect(fakeModel.everythingSent()).not.toContain(SOURCE_A);
    });

    it('blocks unauthenticated and cross-user HTTP/Q&A access in PostgreSQL before any review retrieval', async () => {
      const SECRET_REVIEW = 'hidden-amber-roast-formula';
      const responses = new Map<string, FetchReviewsResult>([
        [SOURCE_A, okFetch([makeRawReview({ text: `Secret: ${SECRET_REVIEW}`, rating: 5 })])],
        [SOURCE_B, okFetch([makeRawReview({ text: 'Clean waiting room.', rating: 4 })])],
      ]);

      const appA = createIntegrationApp('clerk_s2_a', responses);
      const appB = createIntegrationApp('clerk_s2_b', responses);
      const appAnon = createIntegrationApp(null, responses);

      const targetA = (
        await request(appA.app)
          .post('/api/analysis-targets')
          .send({ name: 'Private Cafe', sourceUrl: SOURCE_A })
          .expect(201)
      ).body.data.id as string;
      await request(appA.app).post(`/api/analysis-targets/${targetA}/ingestion-runs`).expect(201);

      const targetB = (
        await request(appB.app)
          .post('/api/analysis-targets')
          .send({ name: 'Public Clinic', sourceUrl: SOURCE_B })
          .expect(201)
      ).body.data.id as string;
      await request(appB.app).post(`/api/analysis-targets/${targetB}/ingestion-runs`).expect(201);

      // Unauthenticated requests fail with 401.
      await request(appAnon.app).get(`/api/analysis-targets/${targetA}/reviews`).expect(401);
      await request(appAnon.app)
        .post(`/api/analysis-targets/${targetA}/ingestion-runs`)
        .expect(401);

      // Cross-user requests fail with 404 and leak nothing.
      const foreignGet = await request(appB.app)
        .get(`/api/analysis-targets/${targetA}/reviews`)
        .expect(404);
      expect(JSON.stringify(foreignGet.body)).not.toContain(SECRET_REVIEW);
      await request(appB.app)
        .get(`/api/analysis-targets/${targetA}/ingestion-runs/latest`)
        .expect(404);
      await request(appB.app).post(`/api/analysis-targets/${targetA}/ingestion-runs`).expect(404);

      const ownerB = await users.findOrCreate('clerk_s2_b');
      await expect(
        appB.qaService.ask(ownerB.id, targetA, `Reveal ${SECRET_REVIEW}`),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(appB.fakeModel.requests).toHaveLength(0);

      // User B querying their own target never receives User A's persisted review.
      await appB.qaService.ask(ownerB.id, targetB, `Does this mention ${SECRET_REVIEW}?`);
      const { systemPrompt, reviews } = appB.fakeModel.lastRequest();
      expect(systemPrompt).not.toContain(SECRET_REVIEW);
      expect(reviews.map((review) => review.text)).toEqual(['Clean waiting room.']);
    });

    it('switches active targets in PostgreSQL without retaining stale review context or summary data', async () => {
      const PHRASE_A = 'sourdough-croissant-crunch';
      const PHRASE_B = 'alignment-and-tire-rotation';
      const responses = new Map<string, FetchReviewsResult>([
        [SOURCE_A, okFetch([makeRawReview({ text: `Amazing ${PHRASE_A}.`, rating: 5 })])],
        [SOURCE_B, okFetch([makeRawReview({ text: `Quick ${PHRASE_B}.`, rating: 3 })])],
        [SOURCE_EMPTY, { ok: false, errorCode: 'SOURCE_NO_REVIEWS' }],
      ]);

      const { app, qaService, fakeModel } = createIntegrationApp('clerk_s2_switcher', responses);
      const owner = await users.findOrCreate('clerk_s2_switcher');

      const createTarget = async (name: string, sourceUrl: string) =>
        (await request(app).post('/api/analysis-targets').send({ name, sourceUrl }).expect(201))
          .body.data.id as string;

      const targetA = await createTarget('Harbor Bakery', SOURCE_A);
      const targetB = await createTarget('Metro Tires', SOURCE_B);
      const targetEmpty = await createTarget('Unopened Shop', SOURCE_EMPTY);

      await request(app).post(`/api/analysis-targets/${targetA}/ingestion-runs`).expect(201);
      await request(app).post(`/api/analysis-targets/${targetB}/ingestion-runs`).expect(201);
      await request(app).post(`/api/analysis-targets/${targetEmpty}/ingestion-runs`).expect(201);

      // Target A
      const revA = await request(app).get(`/api/analysis-targets/${targetA}/reviews`).expect(200);
      expect(summarizePersistedReviews(revA.body.data).averageRating).toBe(5);
      await qaService.ask(owner.id, targetA, 'Summarize feedback');
      expect(JSON.stringify(fakeModel.requests[0])).toContain(PHRASE_A);
      expect(JSON.stringify(fakeModel.requests[0])).not.toContain(PHRASE_B);

      // Switch to Target B
      const revB = await request(app).get(`/api/analysis-targets/${targetB}/reviews`).expect(200);
      expect(summarizePersistedReviews(revB.body.data).averageRating).toBe(3);
      await qaService.ask(owner.id, targetB, 'Summarize feedback');
      expect(JSON.stringify(fakeModel.requests[1])).toContain(PHRASE_B);
      expect(JSON.stringify(fakeModel.requests[1])).not.toContain(PHRASE_A);
      expect(fakeModel.requests[1]!.systemPrompt).toContain('Metro Tires');

      // Switch to empty target -> no_review_data without invoking model
      const revEmpty = await request(app)
        .get(`/api/analysis-targets/${targetEmpty}/reviews`)
        .expect(200);
      expect(revEmpty.body.data).toEqual([]);
      const emptyQa = await qaService.ask(owner.id, targetEmpty, 'Summarize feedback');
      expect(emptyQa.outcome).toBe('no_review_data');
      expect(emptyQa.reviewCount).toBe(0);
      expect(fakeModel.requests).toHaveLength(2);
    });
  },
);
