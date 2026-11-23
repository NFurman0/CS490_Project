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

  describe('no stale context between requests (S2-019)', () => {
    it('keeps each target’s context separate when questions run at the same time', async () => {
      const a1 = await seedTargetWithReviews('clerk_a', 'Volt Phone', [
        { text: BATTERY, rating: 5 },
      ]);
      const a2 = await seedTargetWithReviews('clerk_a', 'Helpdesk Pro', [
        { text: SERVICE, rating: 4 },
      ]);

      // Hold every model call until both have arrived, so the two requests are
      // genuinely in flight together rather than running one after the other.
      let releaseBoth!: () => void;
      const bothArrived = new Promise<void>((resolve) => {
        releaseBoth = resolve;
      });
      const fake = createFakeQaModel(async () => {
        if (fake.requests.length === 2) releaseBoth();
        await bothArrived;
        return { outcome: 'grounded_answer', answer: 'Controlled test answer.' };
      });
      const { service } = serviceWith(fake);

      const [forA, forB] = await Promise.all([
        service.ask(a1.ownerId, a1.target.id, 'What stands out?'),
        service.ask(a2.ownerId, a2.target.id, 'What stands out?'),
      ]);

      expect(fake.requests).toHaveLength(2);
      const requestFor = (name: string) => {
        const request = fake.requests.find((candidate) => candidate.target.name === name);
        if (!request) throw new Error(`No model request for ${name}.`);
        return request;
      };
      const requestA = requestFor('Volt Phone');
      const requestB = requestFor('Helpdesk Pro');

      expect(requestA.reviews.map((review) => review.id)).toEqual(a1.reviewIds);
      expect(JSON.stringify(requestA)).not.toContain(SERVICE);
      expect(requestA.systemPrompt).not.toContain('Helpdesk Pro');

      expect(requestB.reviews.map((review) => review.id)).toEqual(a2.reviewIds);
      expect(JSON.stringify(requestB)).not.toContain(BATTERY);
      expect(requestB.systemPrompt).not.toContain('Volt Phone');

      expect(forA.target.id).toBe(a1.target.id);
      expect(forB.target.id).toBe(a2.target.id);
    });

    it('sends only the current question, with no earlier question or answer', async () => {
      const a1 = await seedTargetWithReviews('clerk_a', 'Volt Phone', [
        { text: BATTERY, rating: 5 },
      ]);
      const a2 = await seedTargetWithReviews('clerk_a', 'Helpdesk Pro', [
        { text: SERVICE, rating: 4 },
      ]);
      const firstQuestion = 'Does the volt phone handle a long camping trip?';
      const firstAnswer = 'Reviewers say the charge survives a whole camping weekend.';
      const secondQuestion = 'How quickly does support respond?';
      const fake = createFakeQaModel();
      fake.respondWith({ outcome: 'grounded_answer', answer: firstAnswer });
      const { service } = serviceWith(fake);

      await service.ask(a1.ownerId, a1.target.id, firstQuestion);
      fake.respondWith({ outcome: 'grounded_answer', answer: 'Support calls back quickly.' });
      await service.ask(a2.ownerId, a2.target.id, secondQuestion);

      const second = fake.lastRequest();
      expect(second.question).toBe(secondQuestion);
      const sent = JSON.stringify(second);
      expect(sent).not.toContain(firstQuestion);
      expect(sent).not.toContain(firstAnswer);
      expect(sent).not.toContain(BATTERY);
    });

    it('uses re-ingested reviews on the next question about the same target', async () => {
      const a1 = await seedTargetWithReviews('clerk_a', 'Volt Phone', []);
      const reviews = createReviewsRepository(testPrisma);
      // Saves a batch through the same path ingestion uses, as one finished run.
      async function ingest(batch: { sourceReviewId: string; text: string; rating: number }[]) {
        const run = await testPrisma.ingestionRun.create({
          data: { targetId: a1.target.id, status: 'RUNNING' },
        });
        await reviews.saveBatchAndFinishRun(
          a1.ownerId,
          a1.target.id,
          run.id,
          batch.map((review) => ({
            ...review,
            reviewerName: null,
            publishedAt: null,
            reviewUrl: null,
            metadata: {},
          })),
          null,
          0,
        );
      }
      const { fake, service } = serviceWith();

      await ingest([{ sourceReviewId: 'google-7', text: 'Checkout line was slow.', rating: 2 }]);
      await service.ask(a1.ownerId, a1.target.id, 'How is checkout?');
      // The reviewer edits their review and a new one arrives; ingestion runs again.
      await ingest([
        { sourceReviewId: 'google-7', text: 'Checkout line moves quickly now.', rating: 4 },
        { sourceReviewId: 'google-8', text: 'Staff helped me at self-checkout.', rating: 5 },
      ]);
      await service.ask(a1.ownerId, a1.target.id, 'How is checkout?');

      // A context cached from the first question would still hold the old text.
      expect(fake.requests).toHaveLength(2);
      expect(fake.lastRequest().reviews.map((review) => review.text)).toEqual([
        'Checkout line moves quickly now.',
        'Staff helped me at self-checkout.',
      ]);
      expect(JSON.stringify(fake.lastRequest())).not.toContain('Checkout line was slow.');
    });

    it('does not reuse the previous target’s reviews when the new target has none', async () => {
      const a1 = await seedTargetWithReviews('clerk_a', 'Volt Phone', [
        { text: BATTERY, rating: 5 },
      ]);
      const empty = await seedTargetWithReviews('clerk_a', 'Helpdesk Pro', []);
      const { fake, service } = serviceWith();

      await service.ask(a1.ownerId, a1.target.id, 'What stands out?');
      const result = await service.ask(empty.ownerId, empty.target.id, 'What stands out?');

      // Only Target A's question reached the model; the empty target never did.
      expect(fake.requests).toHaveLength(1);
      expect(fake.lastRequest().target.name).toBe('Volt Phone');
      expect(result).toMatchObject({
        target: { id: empty.target.id, name: 'Helpdesk Pro' },
        outcome: 'no_review_data',
        reviewCount: 0,
        context: { reviewsUsed: 0, truncated: false },
      });
      expect(JSON.stringify(result)).not.toContain(BATTERY);
    });

    it('does not carry one user’s context into the next user’s identical question', async () => {
      // Same target name and same question for both users, so only the owner
      // separates them: a cache keyed by name or question alone would leak here.
      const userA = await seedTargetWithReviews('clerk_a', 'Copper Kettle Cafe', [
        { text: SECRET, rating: 5 },
      ]);
      const userB = await seedTargetWithReviews('clerk_b', 'Copper Kettle Cafe', [
        { text: SERVICE, rating: 4 },
      ]);
      const question = 'What do reviewers mention most?';
      const { fake, service } = serviceWith();

      await service.ask(userA.ownerId, userA.target.id, question);
      const result = await service.ask(userB.ownerId, userB.target.id, question);

      expect(fake.requests).toHaveLength(2);
      expect(fake.lastRequest().reviews.map((review) => review.id)).toEqual(userB.reviewIds);
      expect(JSON.stringify(fake.lastRequest())).not.toContain(SECRET);
      expect(result.target.id).toBe(userB.target.id);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    });
  });
});
