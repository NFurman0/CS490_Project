import { qaAnswerResponseSchema } from '@reviewlens/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import { createQaRouter, QA_PATH } from '../../src/modules/qa/qa.routes.js';
import { createQaService } from '../../src/modules/qa/qa.service.js';
import { createReviewsRepository } from '../../src/modules/reviews/reviews.repository.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createFakeQaModel } from '../helpers/fake-qa-model.js';
import { seedTargetWithReviews } from '../helpers/qa-fixtures.js';
import {
  evaluateScopeGuardResponse,
  loadScopeGuardEvaluationSet,
} from '../helpers/scope-guard-evaluator.js';
import { createTestApp } from '../helpers/test-app.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

const users = createUsersRepository(testPrisma);
const qaUrl = (targetId: string) => `/api/analysis-targets/${targetId}/qa`;

function appAs(clerkUserId: string | null, fake = createFakeQaModel()) {
  const service = createQaService({
    targets: createTargetsRepository(testPrisma),
    reviews: createReviewsRepository(testPrisma),
    model: fake.model,
    logger: createLogger('silent'),
  });
  const app = createTestApp({
    as: clerkUserId,
    users,
    extraRouters: [{ path: QA_PATH, router: createQaRouter(service) }],
  });
  return { app, fake };
}

const cafeReviews = [
  { text: 'The oat latte is excellent and the staff are friendly.', rating: 5 },
  { text: 'Wi-Fi drops constantly; impossible to work here.', rating: 2 },
  { text: 'Customer service was slow when it got busy.', rating: 3 },
];

describe.skipIf(!hasTestDatabase)('POST /api/analysis-targets/:targetId/qa (database)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("answers from the active target's reviews in the shared response format", async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', cafeReviews);
    const { app, fake } = appAs('clerk_a');
    fake.respondWith({ outcome: 'grounded_answer', answer: 'Reviewers praise the oat latte.' });

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .send({ question: '  What do customers like?  ' })
      .expect(200);

    expect(qaAnswerResponseSchema.parse(res.body).data).toMatchObject({
      target: { id: seeded.target.id, name: 'Copper Kettle Cafe', platform: 'GOOGLE_MAPS' },
      outcome: 'grounded_answer',
      answer: 'Reviewers praise the oat latte.',
      reviewCount: 3,
      context: { reviewsUsed: 3, truncated: false },
    });
    expect(fake.lastRequest().question).toBe('What do customers like?');
    expect(fake.suppliedReviewIds().sort()).toEqual([...seeded.reviewIds].sort());
  });

  it('returns insufficient evidence for an owned, persisted dataset missing parking safety', async () => {
    const fixture = loadScopeGuardEvaluationSet();
    const parkingCase = fixture.cases.find(
      (testCase) => testCase.id === 'insufficient-evidence-001',
    );
    if (!parkingCase) throw new Error('Missing parking-safety evaluation case');
    // Persist the controlled reviews through the normal test helper, rather
    // than handing fixture text directly to the fake model or HTTP response.
    const seeded = await seedTargetWithReviews(
      'clerk_a',
      fixture.target.name,
      fixture.reviews.map(({ text, rating }) => ({ text, rating })),
    );
    const { app, fake } = appAs('clerk_a');
    const answer =
      'The supplied reviews do not mention parking safety at night, so I cannot determine whether the lot is safe.';
    fake.respondWith({ outcome: 'insufficient_evidence', answer });

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .send({ question: parkingCase.question })
      .expect(200);
    const data = qaAnswerResponseSchema.parse(res.body).data;

    // HTTP and shared-contract checks prove the owned database path delivers
    // the active reviews and the visible limitation to the caller.
    expect(fake.lastRequest().question).toBe(parkingCase.question);
    // Persisted rows are ordered by timestamp/ID, not by fixture array position.
    expect(
      fake
        .lastRequest()
        .reviews.map((row) => row.text)
        .sort(),
    ).toEqual(fixture.reviews.map((row) => row.text).sort());
    expect(data).toMatchObject({
      target: { id: seeded.target.id, name: fixture.target.name, platform: 'GOOGLE_MAPS' },
      outcome: parkingCase.expectedOutcome,
      answer,
      reviewCount: fixture.reviews.length,
      context: { reviewsUsed: fixture.reviews.length, truncated: false },
    });
    expect(evaluateScopeGuardResponse(parkingCase, data.answer).acceptable).toBe(true);
  });

  it('returns a scope refusal through HTTP for an owned, persisted review dataset', async () => {
    const fixture = loadScopeGuardEvaluationSet();
    const weatherCase = fixture.cases.find((testCase) => testCase.id === 'general-knowledge-001');
    if (!weatherCase) throw new Error('Missing weather evaluation case');
    // Save the known synthetic dataset before asking: the test must exercise
    // authenticated target ownership and the owner-scoped database read.
    const seeded = await seedTargetWithReviews(
      'clerk_a',
      fixture.target.name,
      fixture.reviews.map(({ text, rating }) => ({ text, rating })),
    );
    const { app, fake } = appAs('clerk_a');
    const answer = `I can only analyze the supplied Google Maps reviews for ${fixture.target.name}, so I cannot provide weather forecasts.`;
    fake.respondWith({ outcome: 'out_of_scope_refusal', answer });

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .send({ question: weatherCase.question })
      .expect(200);
    const data = qaAnswerResponseSchema.parse(res.body).data;
    const modelRequest = fake.lastRequest();

    // Database ordering is independent of fixture order; compare review text
    // sets so this also detects omitted or unrelated reviews.
    expect(modelRequest.target).toEqual({ name: fixture.target.name, platform: 'GOOGLE_MAPS' });
    expect(modelRequest.question).toBe(weatherCase.question);
    expect(modelRequest.systemPrompt).toContain('use "out_of_scope_refusal"');
    expect(modelRequest.reviews.map((row) => row.text).sort()).toEqual(
      fixture.reviews.map((row) => row.text).sort(),
    );
    expect(data).toMatchObject({
      target: { id: seeded.target.id, name: fixture.target.name, platform: 'GOOGLE_MAPS' },
      outcome: weatherCase.expectedOutcome,
      answer,
      reviewCount: fixture.reviews.length,
      context: { reviewsUsed: fixture.reviews.length, truncated: false },
    });
    expect(evaluateScopeGuardResponse(weatherCase, data.answer).acceptable).toBe(true);
    expect(data.answer).not.toMatch(/degrees fahrenheit|chance of rain|sunny with highs/i);
  });

  it('refuses an external platform question using only the owner’s persisted reviews', async () => {
    // Unlike the service-only tests, these reviews are written to the isolated
    // test database and loaded by the real owner-scoped repository through an
    // authenticated HTTP request. The model response is still controlled.
    const fixture = loadScopeGuardEvaluationSet();
    const platformCase = fixture.cases.find((testCase) => testCase.id === 'other-platform-001');
    if (!platformCase) throw new Error('Missing Yelp evaluation case');
    const otherUserReview = 'Private other-user review: the secret blue lantern dessert.';
    // Give a second user a distinctive review so an accidental cross-user
    // query is detectable in both the model request and the HTTP response.
    await seedTargetWithReviews('clerk_b', 'Other User Cafe', [
      { text: otherUserReview, rating: 5 },
    ]);
    const seeded = await seedTargetWithReviews(
      'clerk_a',
      fixture.target.name,
      fixture.reviews.map(({ text, rating }) => ({ text, rating })),
    );
    const { app, fake } = appAs('clerk_a');
    fake.respondWith({
      outcome: 'out_of_scope_refusal',
      answer: platformCase.samplePassingResponse,
    });

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .send({ question: platformCase.question })
      .expect(200);
    const data = qaAnswerResponseSchema.parse(res.body).data;
    const modelRequest = fake.lastRequest();

    // The shared schema verifies the public envelope; these checks separately
    // verify the active target, actual persisted evidence, refusal classification,
    // and absence of the other user's review at the model boundary.
    expect(modelRequest.target).toEqual({ name: fixture.target.name, platform: 'GOOGLE_MAPS' });
    expect(modelRequest.question).toBe(platformCase.question);
    expect(modelRequest.systemPrompt).toContain('reviews or ratings from platforms other than');
    expect(modelRequest.reviews.map((row) => row.text).sort()).toEqual(
      fixture.reviews.map((row) => row.text).sort(),
    );
    expect(modelRequest.availableReviewCount).toBe(fixture.reviews.length);
    expect(fake.everythingSent()).not.toContain(otherUserReview);
    expect(data).toMatchObject({
      target: { id: seeded.target.id, name: fixture.target.name, platform: 'GOOGLE_MAPS' },
      outcome: platformCase.expectedOutcome,
      answer: platformCase.samplePassingResponse,
      reviewCount: fixture.reviews.length,
      context: { reviewsUsed: fixture.reviews.length, truncated: false },
    });
    expect(evaluateScopeGuardResponse(platformCase, data.answer).acceptable).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(otherUserReview);
  });

  it.each([
    'What complaints appear most frequently?',
    'What do customers like about this product?',
    'Are there recurring complaints about customer service?',
    'What themes appear in low-rated reviews?',
    'What reasons do reviewers give for high ratings?',
  ])('sends the representative question "%s" with the full review context', async (question) => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', cafeReviews);
    const { app, fake } = appAs('clerk_a');

    await request(app).post(qaUrl(seeded.target.id)).send({ question }).expect(200);

    expect(fake.lastRequest().question).toBe(question);
    expect(fake.lastRequest().reviews).toHaveLength(3);
    expect(fake.lastRequest().systemPrompt).toContain('Copper Kettle Cafe');
  });

  it('returns no_review_data without calling the model for a target with no reviews', async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Empty Cafe', []);
    const { app, fake } = appAs('clerk_a');

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .send({ question: 'Anything?' })
      .expect(200);

    expect(qaAnswerResponseSchema.parse(res.body).data).toMatchObject({
      target: { id: seeded.target.id, name: 'Empty Cafe' },
      outcome: 'no_review_data',
      reviewCount: 0,
      context: { reviewsUsed: 0, truncated: false },
    });
    expect(res.body.data.answer).toMatch(/no ingested reviews yet.*ingest reviews/i);
    expect(await testPrisma.review.count({ where: { targetId: seeded.target.id } })).toBe(0);
    expect(fake.requests).toHaveLength(0);
  });

  it('returns no_review_data after a failed run saved no reviews', async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Empty Cafe', []);
    await testPrisma.ingestionRun.create({
      data: {
        targetId: seeded.target.id,
        status: 'FAILED',
        errorCode: 'SOURCE_NO_REVIEWS',
        completedAt: new Date(),
      },
    });
    const { app, fake } = appAs('clerk_a');

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .send({ question: 'Anything?' })
      .expect(200);

    expect(qaAnswerResponseSchema.parse(res.body).data).toMatchObject({
      outcome: 'no_review_data',
      reviewCount: 0,
      context: { reviewsUsed: 0, truncated: false },
    });
    expect(res.body.data.answer).toContain('Ingest reviews before asking questions.');
    expect(await testPrisma.review.count({ where: { targetId: seeded.target.id } })).toBe(0);
    expect(fake.requests).toHaveLength(0);
  });

  it('answers from previously saved reviews after a later failed ingestion', async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', cafeReviews);
    await testPrisma.ingestionRun.create({
      data: {
        targetId: seeded.target.id,
        status: 'FAILED',
        errorCode: 'PROVIDER_ERROR',
        reviewCount: 0,
        completedAt: new Date(),
      },
    });
    const { app, fake } = appAs('clerk_a');

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .send({ question: 'What do people like?' })
      .expect(200);

    expect(qaAnswerResponseSchema.parse(res.body).data).toMatchObject({
      outcome: 'grounded_answer',
      reviewCount: 3,
      context: { reviewsUsed: 3, truncated: false },
    });
    expect(fake.requests).toHaveLength(1);
    expect(fake.suppliedReviewIds().sort()).toEqual([...seeded.reviewIds].sort());
  });

  it('rejects a signed-out request with 401, without calling the model', async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', cafeReviews);
    const { app, fake } = appAs(null);

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .set('x-user-id', 'clerk_a')
      .set('x-clerk-user-id', 'clerk_a')
      .send({ question: 'Hi?' })
      .expect(401);

    expect(res.body).not.toHaveProperty('data');
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(fake.requests).toHaveLength(0);
  });

  it("returns 404 for another user's target without revealing it or calling the model", async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', cafeReviews);
    const { app, fake } = appAs('clerk_b');

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .send({ question: 'Summarize these reviews.' })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain('Copper Kettle Cafe');
    expect(fake.requests).toHaveLength(0);
  });

  it("does not expose another user's reviews when an authenticated user asks about them", async () => {
    const secretReview = 'Only User A saw the secret blue lantern dessert.';
    await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', [
      { text: secretReview, rating: 5 },
    ]);
    const userB = await seedTargetWithReviews('clerk_b', 'Volt Phone', [
      { text: 'Battery life lasts all weekend.', rating: 4 },
    ]);
    const fake = createFakeQaModel((modelRequest) => {
      const containsUserAReview = modelRequest.reviews.some((review) =>
        review.text.includes(secretReview),
      );
      return containsUserAReview
        ? { outcome: 'grounded_answer', answer: `User A's review mentions ${secretReview}` }
        : {
            outcome: 'insufficient_evidence',
            answer: 'The active target’s reviews do not provide evidence about that detail.',
          };
    });
    const { app } = appAs('clerk_b', fake);

    const res = await request(app)
      .post(qaUrl(userB.target.id))
      .send({ question: 'What did the Copper Kettle Cafe review say about its dessert?' })
      .expect(200);

    expect(fake.lastRequest().target).toEqual({ name: 'Volt Phone', platform: 'GOOGLE_MAPS' });
    expect(fake.lastRequest().reviews.map((review) => review.text)).toEqual([
      'Battery life lasts all weekend.',
    ]);
    expect(JSON.stringify(fake.lastRequest().reviews)).not.toContain(secretReview);
    expect(res.body.data.outcome).toBe('insufficient_evidence');
    expect(res.body.data.answer).not.toContain(secretReview);
    expect(JSON.stringify(res.body)).not.toContain(secretReview);
  });

  it('returns 404 for a target ID that is not a UUID', async () => {
    const { app, fake } = appAs('clerk_a');

    await request(app).post(qaUrl('not-a-uuid')).send({ question: 'Hi?' }).expect(404);
    expect(fake.requests).toHaveLength(0);
  });

  it.each([
    ['an empty question', { question: '   ' }],
    ['a question over 1,000 characters', { question: 'a'.repeat(1001) }],
    ['client-supplied ownership fields', { question: 'Hi?', ownerId: 'someone-else' }],
  ])('rejects %s with 400 and no model call', async (_label, body) => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', cafeReviews);
    const { app, fake } = appAs('clerk_a');

    const res = await request(app).post(qaUrl(seeded.target.id)).send(body).expect(400);

    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(fake.requests).toHaveLength(0);
  });

  describe('switching the active target (S2-018)', () => {
    // Each dataset repeats its own phrase, so any leak between targets is obvious.
    const BATTERY = 'battery life';
    const SERVICE = 'customer service';
    const batteryReviews = [
      { text: `Great ${BATTERY}, lasts two days.`, rating: 5 },
      { text: `The ${BATTERY} dropped after the update.`, rating: 2 },
      { text: `Decent ${BATTERY} for the price.`, rating: 4 },
    ];
    const serviceReviews = [
      { text: `The ${SERVICE} team called me back fast.`, rating: 5 },
      { text: `Slow ${SERVICE} on weekends.`, rating: 2 },
      { text: `Friendly ${SERVICE} at the front desk.`, rating: 4 },
      { text: `${SERVICE} fixed my billing issue.`, rating: 3 },
    ];

    async function seedTwoTargets() {
      const a = await seedTargetWithReviews('clerk_a', 'Volt Phone', batteryReviews);
      const b = await seedTargetWithReviews('clerk_a', 'Helpdesk Pro', serviceReviews);
      return { a, b };
    }

    // Answers with whichever phrase the supplied reviews mention, so the response
    // itself shows which dataset the model saw.
    function topicEchoModel() {
      return createFakeQaModel(({ reviews }) => {
        const all = reviews.map((review) => review.text).join(' ');
        const topics = [BATTERY, SERVICE].filter((topic) => all.includes(topic));
        return { outcome: 'grounded_answer', answer: `Reviewers discuss ${topics.join(' and ')}.` };
      });
    }

    it("uses only Target B's reviews after switching from Target A", async () => {
      const { a, b } = await seedTwoTargets();
      const { app, fake } = appAs('clerk_a', topicEchoModel());
      const question = { question: 'What do reviewers talk about most?' };

      await request(app).post(qaUrl(a.target.id)).send(question).expect(200);
      const res = await request(app).post(qaUrl(b.target.id)).send(question).expect(200);

      const afterSwitch = fake.lastRequest();
      expect(afterSwitch.reviews.map((review) => review.text).sort()).toEqual(
        serviceReviews.map((review) => review.text).sort(),
      );
      expect(fake.suppliedReviewIds().sort()).toEqual([...b.reviewIds].sort());
      expect(JSON.stringify(afterSwitch)).not.toContain(BATTERY);
      expect(afterSwitch.target).toEqual({ name: 'Helpdesk Pro', platform: 'GOOGLE_MAPS' });
      expect(afterSwitch.systemPrompt).toContain('Helpdesk Pro');
      expect(afterSwitch.systemPrompt).not.toContain('Volt Phone');

      // The response summary describes Target B, not Target A.
      expect(qaAnswerResponseSchema.parse(res.body).data).toMatchObject({
        target: { id: b.target.id, name: 'Helpdesk Pro' },
        answer: `Reviewers discuss ${SERVICE}.`,
        reviewCount: serviceReviews.length,
        context: { reviewsUsed: serviceReviews.length, truncated: false },
      });
      expect(JSON.stringify(res.body)).not.toContain(BATTERY);
      expect(JSON.stringify(res.body)).not.toContain('Volt Phone');
    });

    it("returns to Target A's reviews alone after switching A → B → A", async () => {
      const { a, b } = await seedTwoTargets();
      const { app, fake } = appAs('clerk_a', topicEchoModel());
      const question = { question: 'What do reviewers talk about most?' };

      await request(app).post(qaUrl(a.target.id)).send(question).expect(200);
      await request(app).post(qaUrl(b.target.id)).send(question).expect(200);
      const res = await request(app).post(qaUrl(a.target.id)).send(question).expect(200);

      expect(fake.requests).toHaveLength(3);
      expect(fake.suppliedReviewIds().sort()).toEqual([...a.reviewIds].sort());
      expect(JSON.stringify(fake.lastRequest())).not.toContain(SERVICE);
      expect(fake.lastRequest().systemPrompt).toContain('Volt Phone');
      expect(res.body.data).toMatchObject({
        target: { id: a.target.id, name: 'Volt Phone' },
        answer: `Reviewers discuss ${BATTERY}.`,
        reviewCount: batteryReviews.length,
        context: { reviewsUsed: batteryReviews.length, truncated: false },
      });
    });
  });

  it('returns 503 AI_SERVICE_UNAVAILABLE when the model fails, without provider details', async () => {
    const seeded = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', cafeReviews);
    const { app, fake } = appAs('clerk_a');
    fake.failWith(new Error('Gemini returned HTTP 429 RESOURCE_EXHAUSTED'));

    const res = await request(app)
      .post(qaUrl(seeded.target.id))
      .send({ question: 'Hi?' })
      .expect(503);

    expect(res.body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('429');
    expect(JSON.stringify(res.body)).not.toContain('RESOURCE_EXHAUSTED');
  });
});
