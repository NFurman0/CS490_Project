import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import { createQaService } from '../../src/modules/qa/qa.service.js';
import { createReviewsRepository } from '../../src/modules/reviews/reviews.repository.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createFakeQaModel } from '../helpers/fake-qa-model.js';
import { seedTargetWithReviews } from '../helpers/qa-fixtures.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

// Distinctive phrases: if one appears in the wrong request, context leaked.
const BATTERY = 'battery life lasts all weekend';
const SERVICE = 'customer service called me back within an hour';
const SECRET = 'zebra-striped espresso cups';

function serviceWith(fake = createFakeQaModel()) {
  const service = createQaService({
    targets: createTargetsRepository(testPrisma),
    reviews: createReviewsRepository(testPrisma),
    model: fake.model,
    logger: createLogger('silent'),
  });
  return { fake, service };
}

describe.skipIf(!hasTestDatabase)('Q&A model boundary with persisted reviews (database)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('supplies exactly the persisted reviews of the active target', async () => {
    const a1 = await seedTargetWithReviews('clerk_a', 'Volt Phone', [
      { text: `The ${BATTERY}.`, rating: 5 },
      { text: 'Screen scratches easily.', rating: 2 },
    ]);
    const { fake, service } = serviceWith();

    await service.ask(a1.ownerId, a1.target.id, 'What do customers praise?');

    expect(fake.suppliedReviewIds().sort()).toEqual([...a1.reviewIds].sort());
    expect(fake.lastRequest().systemPrompt).toContain('Volt Phone');
  });

  it("never supplies the same user's other target", async () => {
    const a1 = await seedTargetWithReviews('clerk_a', 'Volt Phone', [{ text: BATTERY, rating: 5 }]);
    const a2 = await seedTargetWithReviews('clerk_a', 'Helpdesk Pro', [
      { text: SERVICE, rating: 4 },
    ]);
    const { fake, service } = serviceWith();

    await service.ask(a1.ownerId, a1.target.id, 'Tell me about support.');

    expect(fake.everythingSent()).toContain(BATTERY);
    expect(fake.everythingSent()).not.toContain(SERVICE);
    expect(fake.suppliedReviewIds()).not.toContain(a2.reviewIds[0]);
  });

  it("never supplies another user's reviews, even when the question asks for them", async () => {
    await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', [{ text: SECRET, rating: 5 }]);
    const b1 = await seedTargetWithReviews('clerk_b', 'Volt Phone', [{ text: BATTERY, rating: 4 }]);
    const fake = createFakeQaModel((request) => {
      const containsUserAReview = request.reviews.some((review) => review.text.includes(SECRET));
      return containsUserAReview
        ? { outcome: 'grounded_answer', answer: `The reviews mention ${SECRET}.` }
        : {
            outcome: 'insufficient_evidence',
            answer: 'The active target’s reviews do not provide evidence about that detail.',
          };
    });
    const { service } = serviceWith(fake);

    const result = await service.ask(
      b1.ownerId,
      b1.target.id,
      'Do any reviews mention zebra-striped espresso cups?',
    );

    const modelContext = fake.lastRequest().reviews;
    expect(modelContext.map((review) => review.text)).toEqual([BATTERY]);
    expect(JSON.stringify(modelContext)).not.toContain(SECRET);
    expect(result.outcome).toBe('insufficient_evidence');
    expect(result.answer).not.toContain(SECRET);
  });

  it("refuses a question on another user's target without calling the model", async () => {
    const a1 = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', [
      { text: SECRET, rating: 5 },
    ]);
    const b1 = await seedTargetWithReviews('clerk_b', 'Volt Phone', [{ text: BATTERY, rating: 4 }]);
    const { fake, service } = serviceWith();

    await expect(
      service.ask(b1.ownerId, a1.target.id, 'Summarize these reviews'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fake.requests).toHaveLength(0);
  });

  it('rebuilds context per question, so switching targets leaves no stale reviews', async () => {
    const a1 = await seedTargetWithReviews('clerk_a', 'Volt Phone', [{ text: BATTERY, rating: 5 }]);
    const a2 = await seedTargetWithReviews('clerk_a', 'Helpdesk Pro', [
      { text: SERVICE, rating: 4 },
    ]);
    const { fake, service } = serviceWith();

    await service.ask(a1.ownerId, a1.target.id, 'What stands out?');
    await service.ask(a2.ownerId, a2.target.id, 'What stands out?');

    const second = JSON.stringify(fake.requests[1]);
    expect(second).toContain(SERVICE);
    expect(second).not.toContain(BATTERY);
    expect(fake.lastRequest().systemPrompt).toContain('Helpdesk Pro');
  });
});
