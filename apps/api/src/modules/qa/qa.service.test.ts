import type { AnalysisTarget, Review } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createFakeQaModel } from '../../../test/helpers/fake-qa-model.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { QA_OUTCOMES } from './qa-model.js';
import { createQaService } from './qa.service.js';
import { buildSystemPrompt } from './system-prompt.js';

const OWNER = 'owner-a';
const TARGET_ID = '11111111-1111-4111-8111-111111111111';

const target = {
  id: TARGET_ID,
  ownerId: OWNER,
  name: 'Copper Kettle Cafe',
  platform: 'GOOGLE_MAPS',
  sourceUrl: 'https://maps.google.com/?cid=1',
  createdAt: new Date(),
} as AnalysisTarget;

function review(id: string, text: string, rating = 4): Review {
  return {
    id,
    targetId: TARGET_ID,
    sourceReviewId: 'src-' + id,
    text,
    rating,
    reviewerName: 'Sam',
    publishedAt: '2026-10-01',
    reviewUrl: 'https://maps.google.com/review/' + id,
    metadata: { provider: 'serpapi' },
    createdAt: new Date(),
  } as Review;
}

const storedReviews = [
  review('r1', 'The oat latte is excellent.', 5),
  review('r2', 'Wi-Fi drops often.', 2),
];

function setup(reviewRows: Review[] = storedReviews) {
  const fake = createFakeQaModel();
  const findById = vi.fn(async (ownerId: string, id: string) =>
    ownerId === OWNER && id === TARGET_ID ? target : null,
  );
  const findByTarget = vi.fn(async () => reviewRows);
  const logger = { error: vi.fn(), warn: vi.fn() } as unknown as Logger;
  const service = createQaService({
    targets: { findById },
    reviews: { findByTarget },
    model: fake.model,
    logger,
  });
  return { fake, service, findById, findByTarget };
}

async function captureAppError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('Q&A orchestration (deterministic harness)', () => {
  it('sends the system prompt built for the active target', async () => {
    const { fake, service } = setup();

    await service.ask(OWNER, TARGET_ID, 'What do people like?');

    const request = fake.lastRequest();
    expect(request.systemPrompt).toBe(
      buildSystemPrompt({ name: target.name, platform: 'GOOGLE_MAPS' }),
    );
    expect(request.systemPrompt).toContain('Copper Kettle Cafe');
    expect(request.systemPrompt).toContain('Google Maps');
    expect(request.target).toEqual({ name: 'Copper Kettle Cafe', platform: 'GOOGLE_MAPS' });
    expect(request.question).toBe('What do people like?');
  });

  it("supplies exactly the active target's reviews, with only the fields an answer needs", async () => {
    const { fake, service, findByTarget } = setup();

    await service.ask(OWNER, TARGET_ID, 'Any complaints?');

    expect(findByTarget).toHaveBeenCalledWith(OWNER, TARGET_ID);
    expect(fake.suppliedReviewIds()).toEqual(['r1', 'r2']);
    expect(fake.lastRequest().reviews[0]).toEqual({
      id: 'r1',
      rating: 5,
      text: 'The oat latte is excellent.',
      reviewerName: 'Sam',
      publishedAt: '2026-10-01',
    });
    const sent = fake.everythingSent();
    expect(sent).not.toContain(OWNER);
    expect(sent).not.toContain('serpapi');
    expect(sent).not.toContain('https://maps.google.com/review/');
  });

  it.each(QA_OUTCOMES)(
    'returns a controlled %s response to the caller unchanged',
    async (outcome) => {
      const { fake, service } = setup();
      fake.respondWith({ outcome, answer: `Controlled ${outcome} text.` });

      const result = await service.ask(OWNER, TARGET_ID, 'Question?');

      expect(result).toEqual({
        target: { id: TARGET_ID, name: 'Copper Kettle Cafe', platform: 'GOOGLE_MAPS' },
        outcome,
        answer: `Controlled ${outcome} text.`,
        reviewCount: 2,
      });
    },
  );

  it('turns a provider failure into AI_SERVICE_UNAVAILABLE without exposing provider details', async () => {
    const { fake, service } = setup();
    fake.failWith(new Error('429 Too Many Requests: org-secret-123 rate limit'));

    const error = await captureAppError(service.ask(OWNER, TARGET_ID, 'Question?'));

    expect(error.code).toBe('AI_SERVICE_UNAVAILABLE');
    expect(error.httpStatus).toBe(503);
    expect(error.message).not.toContain('429');
    expect(error.message).not.toContain('org-secret-123');
  });

  it.each([
    ['plain text instead of JSON', 'The latte is great.'],
    ['an unknown outcome', { outcome: 'maybe', answer: 'Hmm.' }],
    ['an empty answer', { outcome: 'grounded_answer', answer: '   ' }],
    ['extra fields', { outcome: 'grounded_answer', answer: 'Yes.', reviewsUsed: 99 }],
  ])('treats a model response with %s as a provider failure', async (_label, malformed) => {
    const { fake, service } = setup();
    fake.returnMalformed(malformed);

    const error = await captureAppError(service.ask(OWNER, TARGET_ID, 'Question?'));

    expect(error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });

  it('does not call the model when the target has no reviews', async () => {
    const { fake, service } = setup([]);

    const result = await service.ask(OWNER, TARGET_ID, 'What do people like?');

    expect(result.outcome).toBe('no_review_data');
    expect(result.reviewCount).toBe(0);
    expect(fake.requests).toHaveLength(0);
  });

  it("rejects another user's target before reading reviews or calling the model", async () => {
    const { fake, service, findByTarget } = setup();

    const error = await captureAppError(service.ask('owner-b', TARGET_ID, 'Show me the reviews'));

    expect(error.code).toBe('NOT_FOUND');
    expect(findByTarget).not.toHaveBeenCalled();
    expect(fake.requests).toHaveLength(0);
  });
});
