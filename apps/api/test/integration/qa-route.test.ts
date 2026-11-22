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

    expect(res.body.data.outcome).toBe('no_review_data');
    expect(fake.requests).toHaveLength(0);
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
