import type { AnalysisTarget, Review } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createFakeQaModel } from '../../../test/helpers/fake-qa-model.js';
import {
  evaluateScopeGuardResponse,
  loadScopeGuardEvaluationSet,
} from '../../../test/helpers/scope-guard-evaluator.js';
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

// Use the same known-absence dataset for both unsupported and supported questions.
// The fake model controls the response; these tests establish what the service sends
// and returns, not whether Gemini itself would make the right judgment.
const evaluationSet = loadScopeGuardEvaluationSet();
const evaluationReviews = evaluationSet.reviews.map((row) => review(row.id, row.text, row.rating));
const evaluationCase = (id: string) => {
  const testCase = evaluationSet.cases.find((candidate) => candidate.id === id);
  if (!testCase) throw new Error(`Missing scope-guard case: ${id}`);
  return testCase;
};

function setup(reviewRows: Review[] = storedReviews, contextTokenBudget?: number) {
  const fake = createFakeQaModel();
  const findById = vi.fn(async (ownerId: string, id: string) =>
    ownerId === OWNER && id === TARGET_ID ? target : null,
  );
  const findByTarget = vi.fn(async () => reviewRows);
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Logger;
  const service = createQaService({
    targets: { findById },
    reviews: { findByTarget },
    model: fake.model,
    logger,
    contextTokenBudget,
  });
  return { fake, service, findById, findByTarget, logger };
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
  it.each([
    [
      'insufficient-evidence-001',
      'The supplied reviews do not mention parking-lot safety at night, so I cannot determine whether it is safe.',
    ],
    [
      'insufficient-evidence-002',
      'The supplied reviews mention croissants but do not state whether any pastries are vegan or gluten-free.',
    ],
    [
      'insufficient-evidence-003',
      'The supplied reviews mention patio tables but do not state whether dogs are allowed inside or on the patio.',
    ],
  ])('explains missing evidence from the active reviews for %s', async (caseId, answer) => {
    const testCase = evaluationCase(caseId);
    const { fake, service, findByTarget } = setup(evaluationReviews);
    fake.respondWith({ outcome: 'insufficient_evidence', answer });

    const result = await service.ask(OWNER, TARGET_ID, testCase.question);
    const request = fake.lastRequest();

    // Inspect the actual model boundary so a passing response alone cannot mask
    // a missing review, wrong target, or missing prompt instruction.
    expect(findByTarget).toHaveBeenCalledWith(OWNER, TARGET_ID);
    expect(request.question).toBe(testCase.question);
    expect(request.target).toEqual({ name: evaluationSet.target.name, platform: 'GOOGLE_MAPS' });
    expect(request.reviews.map((row) => row.text)).toEqual(
      evaluationSet.reviews.map((row) => row.text),
    );
    expect(request.availableReviewCount).toBe(evaluationSet.reviews.length);
    expect(request.systemPrompt).toContain('support the specific claim');
    expect(request.systemPrompt).toContain('Mentions of related topics do not establish');
    expect(request.systemPrompt).toContain('use "insufficient_evidence"');
    expect(result).toMatchObject({
      outcome: testCase.expectedOutcome,
      answer,
      reviewCount: evaluationSet.reviews.length,
      context: { reviewsUsed: evaluationSet.reviews.length, truncated: false },
    });
    // The evaluator checks the returned answer text; outcome is asserted above.
    expect(evaluateScopeGuardResponse(testCase, result.answer).acceptable).toBe(true);
  });

  it('still answers a supported studying question from the same review set', async () => {
    const testCase = evaluationCase('in-scope-003');
    const { fake, service } = setup(evaluationReviews);
    fake.respondWith({
      outcome: 'grounded_answer',
      answer:
        'A reviewer describes quiet weekday seating, reliable Wi-Fi, and window outlets for studying.',
    });

    const result = await service.ask(OWNER, TARGET_ID, testCase.question);

    expect(fake.lastRequest().reviews.map((row) => row.text)).toEqual(
      evaluationSet.reviews.map((row) => row.text),
    );
    expect(fake.lastRequest().systemPrompt).toContain('use "grounded_answer"');
    expect(result.outcome).toBe(testCase.expectedOutcome);
    expect(evaluateScopeGuardResponse(testCase, result.answer).acceptable).toBe(true);
  });

  // These responses are controlled: the boundary assertions establish which
  // instructions and owned reviews Gemini receives, not Gemini's judgment.
  it.each(evaluationSet.cases.filter((testCase) => testCase.category === 'general_knowledge'))(
    'passes the active review scope to the model and returns a refusal for $id',
    async (testCase) => {
      const { fake, service, findByTarget } = setup(evaluationReviews);
      const answer = `I can only analyze the supplied Google Maps reviews for ${target.name}, so I cannot fulfill this unrelated request.`;
      fake.respondWith({ outcome: 'out_of_scope_refusal', answer });

      const result = await service.ask(OWNER, TARGET_ID, testCase.question);
      const modelRequest = fake.lastRequest();

      expect(findByTarget).toHaveBeenCalledWith(OWNER, TARGET_ID);
      expect(modelRequest.systemPrompt).toBe(buildSystemPrompt(modelRequest.target));
      expect(modelRequest.systemPrompt).toContain("First decide whether the user's request");
      expect(modelRequest.systemPrompt).toContain('Do not answer any factual subpart');
      expect(modelRequest.systemPrompt).toContain('use "out_of_scope_refusal"');
      expect(modelRequest.target).toEqual({
        name: evaluationSet.target.name,
        platform: 'GOOGLE_MAPS',
      });
      expect(modelRequest.question).toBe(testCase.question);
      expect(modelRequest.reviews.map((row) => row.text)).toEqual(
        evaluationSet.reviews.map((row) => row.text),
      );
      expect(modelRequest.availableReviewCount).toBe(evaluationSet.reviews.length);
      expect(result).toMatchObject({
        target: { id: TARGET_ID, name: target.name, platform: 'GOOGLE_MAPS' },
        outcome: testCase.expectedOutcome,
        answer,
        reviewCount: evaluationSet.reviews.length,
        context: { reviewsUsed: evaluationSet.reviews.length, truncated: false },
      });
      // The evaluator examines returned text; the outcome is checked separately.
      expect(evaluateScopeGuardResponse(testCase, result.answer).acceptable).toBe(true);
      expect(evaluateScopeGuardResponse(testCase, testCase.sampleFailingResponse).acceptable).toBe(
        false,
      );
    },
  );

  // The fixture covers named and unnamed competitors, overall comparisons,
  // other review platforms, and mixed requests. These are controlled model
  // responses: the request assertions verify the boundary, while the evaluator
  // checks the refusal text. Neither assertion proves Gemini will choose it.
  it.each(
    evaluationSet.cases.filter(
      (testCase) => testCase.category === 'other_entity' || testCase.category === 'other_platform',
    ),
  )(
    'refuses unsupported entity or platform requests using active reviews for $id',
    async (testCase) => {
      const { fake, service, findByTarget } = setup(evaluationReviews);
      fake.respondWith({ outcome: 'out_of_scope_refusal', answer: testCase.samplePassingResponse });

      const result = await service.ask(OWNER, TARGET_ID, testCase.question);
      const request = fake.lastRequest();

      expect(findByTarget).toHaveBeenCalledWith(OWNER, TARGET_ID);
      expect(request.systemPrompt).toBe(buildSystemPrompt(request.target));
      expect(request.systemPrompt).toContain('another entity or states a comparison');
      expect(request.systemPrompt).toContain('refuse the unsupported comparison');
      expect(request.target).toEqual({ name: evaluationSet.target.name, platform: 'GOOGLE_MAPS' });
      // A competitor mention inside one of these reviews is allowed through
      // as active-target evidence; no second target's reviews are fetched.
      expect(request.reviews.map((row) => row.text)).toEqual(
        evaluationSet.reviews.map((row) => row.text),
      );
      expect(request.availableReviewCount).toBe(evaluationSet.reviews.length);
      expect(request.question).toBe(testCase.question);
      expect(result).toMatchObject({
        target: { id: TARGET_ID, name: target.name, platform: 'GOOGLE_MAPS' },
        outcome: testCase.expectedOutcome,
        answer: testCase.samplePassingResponse,
        reviewCount: evaluationSet.reviews.length,
        context: { reviewsUsed: evaluationSet.reviews.length, truncated: false },
      });
      expect(evaluateScopeGuardResponse(testCase, result.answer).acceptable).toBe(true);
    },
  );

  // Positive controls prevent a blanket competitor/platform-name refusal:
  // ordinary coffee and wait questions, an attributed preference, and a patio
  // question containing an incidental Yelp mention must remain answerable.
  it.each(['in-scope-002', 'in-scope-004', 'in-scope-005', 'in-scope-006', 'in-scope-007'])(
    'keeps supported active-target questions in scope for %s',
    async (caseId) => {
      const testCase = evaluationCase(caseId);
      const { fake, service } = setup(evaluationReviews);
      fake.respondWith({ outcome: 'grounded_answer', answer: testCase.samplePassingResponse });

      const result = await service.ask(OWNER, TARGET_ID, testCase.question);
      const request = fake.lastRequest();

      expect(request.question).toBe(testCase.question);
      expect(request.reviews.map((row) => row.text)).toEqual(
        evaluationSet.reviews.map((row) => row.text),
      );
      expect(request.availableReviewCount).toBe(evaluationSet.reviews.length);
      expect(request.systemPrompt).toContain('clearly attributing the opinion');
      expect(request.systemPrompt).toContain('incidental name of another business or platform');
      expect(result.outcome).toBe(testCase.expectedOutcome);
      expect(evaluateScopeGuardResponse(testCase, result.answer).acceptable).toBe(true);
    },
  );

  it('accepts an attributed reviewer preference but refuses an unsupported overall verdict', async () => {
    const narrow = evaluationCase('in-scope-004');
    const overall = evaluationCase('other-entity-005');
    const { fake, service } = setup(evaluationReviews);
    // Both questions receive the same active review containing the preference.
    // The requested claim, not the mere presence of "Starbucks", determines
    // whether the controlled response is grounded or out of scope.
    fake.respondWith({ outcome: 'grounded_answer', answer: narrow.samplePassingResponse });
    const attributed = await service.ask(OWNER, TARGET_ID, narrow.question);
    fake.respondWith({ outcome: 'out_of_scope_refusal', answer: overall.samplePassingResponse });
    const refused = await service.ask(OWNER, TARGET_ID, overall.question);

    expect(fake.requests).toHaveLength(2);
    for (const request of fake.requests) {
      expect(request.reviews.some((row) => row.text.includes('preferred Copper Kettle'))).toBe(
        true,
      );
    }
    expect(attributed.outcome).toBe('grounded_answer');
    expect(evaluateScopeGuardResponse(narrow, attributed.answer).acceptable).toBe(true);
    expect(refused.outcome).toBe('out_of_scope_refusal');
    expect(evaluateScopeGuardResponse(overall, refused.answer).acceptable).toBe(true);
  });

  it('exposes a fabricated external answer that passes response-shape validation', async () => {
    const testCase = evaluationCase('other-platform-001');
    const { fake, service } = setup(evaluationReviews);
    fake.respondWith({ outcome: 'grounded_answer', answer: testCase.sampleFailingResponse });

    const result = await service.ask(OWNER, TARGET_ID, testCase.question);

    // The service accepts valid { outcome, answer } JSON without checking
    // factual truth. Only the test evaluator detects the fabricated Yelp fact;
    // that evaluator is not a runtime guard.
    expect(result.outcome).toBe('grounded_answer');
    expect(evaluateScopeGuardResponse(testCase, result.answer).acceptable).toBe(false);
  });

  it('does not imply that an omitted competitor mention was checked when context is trimmed', async () => {
    // Force the review mentioning Starbucks over budget while keeping a short
    // active-target review. The model knows two reviews exist but receives only
    // one, so an answer must be limited to the supplied subset.
    const omittedMention = review(
      'omitted',
      'I preferred Copper Kettle to Starbucks. ' + 'x'.repeat(2000),
    );
    const supplied = review('supplied', 'The espresso at Copper Kettle tastes good.');
    const { fake, service } = setup([omittedMention, supplied], 110);
    const question = 'What do the supplied reviews say about Starbucks?';
    const answer =
      'I cannot report a Starbucks comparison from the supplied Copper Kettle reviews.';
    fake.respondWith({ outcome: 'out_of_scope_refusal', answer });

    const result = await service.ask(OWNER, TARGET_ID, question);

    expect(fake.lastRequest().reviews.map((row) => row.text)).toEqual([supplied.text]);
    expect(fake.lastRequest().availableReviewCount).toBe(2);
    expect(fake.lastRequest().systemPrompt).toContain('reviews that were not supplied');
    expect(result.context).toEqual({ reviewsUsed: 1, truncated: true });
    expect(result.answer).toContain('supplied Copper Kettle reviews');
    expect(result.answer).not.toMatch(/all (?:saved|ingested) reviews/i);
  });

  it('keeps an active restaurant review question in scope despite restaurant wording', async () => {
    const { fake, service } = setup(evaluationReviews);
    fake.respondWith({
      outcome: 'grounded_answer',
      answer: 'Reviewers praise the coffee and croissants at Copper Kettle Cafe.',
    });

    const result = await service.ask(
      OWNER,
      TARGET_ID,
      'What do reviewers like about this restaurant?',
    );

    // The same restaurant word in a recommendation request must not become a
    // keyword-based refusal for a question about this target's own reviews.
    expect(fake.lastRequest().systemPrompt).toContain("Judge the request's meaning");
    expect(result.outcome).toBe('grounded_answer');
    expect(result.answer).toContain('coffee and croissants');
  });

  it('shows that a valid-shaped trivia answer still requires real-model validation', async () => {
    const testCase = evaluationCase('general-knowledge-003');
    const { fake, service } = setup(evaluationReviews);
    fake.respondWith({ outcome: 'grounded_answer', answer: testCase.sampleFailingResponse });

    const result = await service.ask(OWNER, TARGET_ID, testCase.question);

    // The service checks response shape, not semantic scope. This negative
    // control must fail the evaluator despite passing through the service.
    expect(result.outcome).toBe('grounded_answer');
    expect(evaluateScopeGuardResponse(testCase, result.answer).acceptable).toBe(false);
  });

  it('flags a fabricated parking-safety answer even when its model response has a valid shape', async () => {
    const testCase = evaluationCase('insufficient-evidence-001');
    const { fake, service } = setup(evaluationReviews);
    fake.respondWith({
      outcome: 'grounded_answer',
      answer: 'Customers say the parking lot is well-lit and has security guards at night.',
    });

    const result = await service.ask(OWNER, TARGET_ID, testCase.question);

    // Shape validation alone cannot detect an unsupported claim. This negative
    // evaluator assertion makes that limitation visible without adding a new
    // per-question runtime judge to the service.
    expect(result.outcome).toBe('grounded_answer');
    const evaluation = evaluateScopeGuardResponse(testCase, result.answer);
    expect(evaluation.acceptable).toBe(false);
    expect(evaluation.reasons).toContain('Contains forbidden or hallucinated content: "well-lit".');
  });

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
        context: { reviewsUsed: 2, truncated: false },
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

  it('sends a trimmed context and reports it when reviews exceed the token budget', async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      review(`m${i}`, `${i} ${'x'.repeat(400)}`, (i % 5) + 1),
    );
    const { fake, service, logger } = setup(many, 300);

    const result = await service.ask(OWNER, TARGET_ID, 'Summarize the reviews.');

    expect(fake.lastRequest().reviews.length).toBeLessThan(6);
    expect(fake.lastRequest().availableReviewCount).toBe(6);
    expect(result.context).toEqual({
      reviewsUsed: fake.lastRequest().reviews.length,
      truncated: true,
    });
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it('does not call the model when the target has no reviews', async () => {
    const { fake, service } = setup([]);

    const result = await service.ask(OWNER, TARGET_ID, 'What do people like?');

    expect(result.outcome).toBe('no_review_data');
    expect(result.reviewCount).toBe(0);
    expect(fake.requests).toHaveLength(0);
  });

  it('does not call the model when saved reviews cannot fit the question context', async () => {
    const { fake, service, findByTarget } = setup(storedReviews, 1);

    const result = await service.ask(OWNER, TARGET_ID, 'What do people like?');

    expect(findByTarget).toHaveBeenCalledWith(OWNER, TARGET_ID);
    expect(result).toMatchObject({
      outcome: 'insufficient_evidence',
      reviewCount: 2,
      context: { reviewsUsed: 0, truncated: true },
    });
    expect(result.answer).toContain('saved reviews');
    expect(result.answer).not.toContain('no ingested reviews');
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
