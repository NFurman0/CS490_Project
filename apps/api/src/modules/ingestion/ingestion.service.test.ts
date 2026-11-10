import type { AnalysisTarget, IngestionRun } from '@prisma/client';
import { INGESTION_ERROR_CODES } from '@reviewlens/shared';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../lib/logger.js';
import type { FinishedRun, IngestionRunsRepository } from './ingestion-runs.repository.js';
import { createIngestionService, type OwnedTargetLookup } from './ingestion.service.js';
import type { FetchReviewsResult, RawReview, ReviewSource } from './review-source.js';
import type { ReviewsRepository } from '../reviews/reviews.repository.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_URL = 'https://maps.google.com/?cid=123456';

function target(overrides: Partial<AnalysisTarget> = {}): AnalysisTarget {
  return {
    id: TARGET_ID,
    ownerId: OWNER_ID,
    name: "Joe's Pizza",
    platform: 'GOOGLE_MAPS',
    sourceUrl: SOURCE_URL,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  };
}

function rawReview(n: number): RawReview {
  return {
    sourceReviewId: `r${n}`,
    text: `Review ${n}`,
    rating: 5,
    reviewerName: null,
    publishedAt: null,
    reviewUrl: null,
    metadata: {},
  };
}

/** In-memory runs repository that records every run it starts and finishes. */
function fakeRuns() {
  const rows = new Map<string, IngestionRun>();
  let next = 0;
  const repo: IngestionRunsRepository = {
    start: vi.fn(async (targetId: string) => {
      const run: IngestionRun = {
        id: `run-${++next}`,
        targetId,
        status: 'RUNNING',
        errorCode: null,
        reviewCount: 0,
        startedAt: new Date(),
        completedAt: null,
      };
      rows.set(run.id, run);
      return run;
    }),
    finish: vi.fn(async (runId: string, outcome: FinishedRun) => {
      const run = { ...rows.get(runId)!, ...outcome, completedAt: new Date() };
      rows.set(runId, run);
      return run;
    }),
    findLatest: vi.fn(
      async (targetId: string) =>
        [...rows.values()].filter((run) => run.targetId === targetId).at(-1) ?? null,
    ),
  };
  return { repo, rows };
}

function setup({
  found = target() as AnalysisTarget | null,
  result = { ok: true, place: { title: null, address: null, totalReviews: null }, reviews: [] } as
    FetchReviewsResult | Error,
} = {}) {
  const targets: OwnedTargetLookup = { findById: vi.fn(async () => found) };
  const runs = fakeRuns();
  // A fake lets service tests check decisions (which reviews/counts to save).
  // It cannot prove rows exist in PostgreSQL; reviews.test.ts does that.
  const reviews: ReviewsRepository = {
    findByTarget: vi.fn(async () => []),
    saveBatchAndFinishRun: vi.fn(async (_ownerId, _targetId, runId, batch, stoppedEarly) =>
      runs.repo.finish(runId, {
        status: 'SUCCEEDED',
        errorCode: stoppedEarly,
        reviewCount: batch.length,
      }),
    ),
  };
  const fetchReviews = vi.fn<ReviewSource['fetchReviews']>(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const service = createIngestionService({
    targets,
    runs: runs.repo,
    reviews,
    reviewSource: { fetchReviews },
    maxReviewsPerRun: 25,
    logger: createLogger('silent'),
  });
  return { service, targets, runs, reviews, fetchReviews };
}

const place = { title: "Joe's Pizza", address: null, totalReviews: 3 };

describe('latestRun', () => {
  it('checks ownership before reading any ingestion run', async () => {
    const { service, targets, runs, fetchReviews } = setup({ found: null });

    await expect(service.latestRun(OWNER_ID, TARGET_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
    expect(targets.findById).toHaveBeenCalledWith(OWNER_ID, TARGET_ID);
    expect(runs.repo.findLatest).not.toHaveBeenCalled();
    expect(fetchReviews).not.toHaveBeenCalled();
  });

  it('returns null when the owned target has no ingestion run', async () => {
    const { service, runs } = setup();

    await expect(service.latestRun(OWNER_ID, TARGET_ID)).resolves.toBeNull();
    expect(runs.repo.findLatest).toHaveBeenCalledWith(TARGET_ID);
  });
});

describe('startIngestion', () => {
  it('rejects a missing or not-owned target before creating a run or calling the source', async () => {
    const { service, targets, runs, fetchReviews } = setup({ found: null });

    await expect(service.startIngestion(OWNER_ID, TARGET_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
    expect(targets.findById).toHaveBeenCalledWith(OWNER_ID, TARGET_ID);
    expect(runs.repo.start).not.toHaveBeenCalled();
    expect(fetchReviews).not.toHaveBeenCalled();
  });

  it('rejects a target with no source link before creating a run or calling the source', async () => {
    const { service, runs, fetchReviews } = setup({ found: target({ sourceUrl: '   ' }) });

    await expect(service.startIngestion(OWNER_ID, TARGET_ID)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      httpStatus: 400,
      message: expect.stringContaining('review source link'),
    });
    expect(runs.repo.start).not.toHaveBeenCalled();
    expect(fetchReviews).not.toHaveBeenCalled();
  });

  it("fetches from the target's stored source URL, capped at MAX_REVIEWS_PER_RUN", async () => {
    const { service, fetchReviews } = setup();

    await service.startIngestion(OWNER_ID, TARGET_ID);

    expect(fetchReviews).toHaveBeenCalledOnce();
    expect(fetchReviews).toHaveBeenCalledWith({ sourceUrl: SOURCE_URL, maxReviews: 25 });
  });

  it('records a succeeded run with the number of usable normalized reviews', async () => {
    // Three fetched records, one invalid: this catches the old raw-array count.
    // The fractional rating on the last record must still count as valid.
    const { service, runs } = setup({
      result: {
        ok: true,
        place,
        reviews: [rawReview(1), { ...rawReview(2), text: null }, { ...rawReview(3), rating: 4.5 }],
      },
    });

    const run = await service.startIngestion(OWNER_ID, TARGET_ID);

    expect(runs.repo.start).toHaveBeenCalledWith(TARGET_ID);
    expect(run).toMatchObject({
      targetId: TARGET_ID,
      status: 'SUCCEEDED',
      errorCode: null,
      reviewCount: 2,
      completedAt: expect.any(Date),
    });
  });

  it('fails with SOURCE_NO_REVIEWS when every returned record is unusable', async () => {
    // `result.ok` says SerpApi fetched a page, not that any Review is usable.
    const { service, runs } = setup({
      result: {
        ok: true,
        place,
        reviews: [
          { ...rawReview(1), text: null },
          { ...rawReview(2), rating: NaN },
        ],
      },
    });
    const run = await service.startIngestion(OWNER_ID, TARGET_ID);

    expect(runs.repo.start).toHaveBeenCalledWith(TARGET_ID);
    expect(run).toMatchObject({
      status: 'FAILED',
      errorCode: 'SOURCE_NO_REVIEWS',
      reviewCount: 0,
      completedAt: expect.any(Date),
    });
  });

  it('reports SOURCE_NO_REVIEWS instead of a paging error if no collected review is usable', async () => {
    // The partial-page code cannot imply success when zero reviews survive.
    const { service } = setup({
      result: {
        ok: true,
        place,
        reviews: [{ ...rawReview(1), rating: null }],
        stoppedEarly: 'PROVIDER_TIMEOUT',
      },
    });

    expect(await service.startIngestion(OWNER_ID, TARGET_ID)).toMatchObject({
      status: 'FAILED',
      errorCode: 'SOURCE_NO_REVIEWS',
      reviewCount: 0,
    });
  });

  // PERSISTENCE_ERROR is generated after a fetch, never supplied by a source.
  it.each(INGESTION_ERROR_CODES.filter((code) => code !== 'PERSISTENCE_ERROR'))(
    'records a failed run with zero reviews for %s',
    async (code) => {
      const { service } = setup({ result: { ok: false, errorCode: code } });

      const run = await service.startIngestion(OWNER_ID, TARGET_ID);

      expect(run).toMatchObject({ status: 'FAILED', errorCode: code, reviewCount: 0 });
    },
  );

  it('keeps a partial result as succeeded and records why paging stopped', async () => {
    const { service } = setup({
      result: { ok: true, place, reviews: [rawReview(1)], stoppedEarly: 'PROVIDER_TIMEOUT' },
    });

    const run = await service.startIngestion(OWNER_ID, TARGET_ID);

    expect(run).toMatchObject({
      status: 'SUCCEEDED',
      errorCode: 'PROVIDER_TIMEOUT',
      reviewCount: 1,
    });
  });

  it('marks the run failed and rethrows when the source throws unexpectedly', async () => {
    const boom = new Error('unexpected');
    const { service, runs } = setup({ result: boom });

    await expect(service.startIngestion(OWNER_ID, TARGET_ID)).rejects.toBe(boom);

    const [run] = [...runs.rows.values()];
    expect(run).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR', reviewCount: 0 });
  });
});
