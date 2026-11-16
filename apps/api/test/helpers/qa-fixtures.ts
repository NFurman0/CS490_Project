import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { testPrisma } from './test-database.js';

const users = createUsersRepository(testPrisma);
const targets = createTargetsRepository(testPrisma);

export interface SeedReview {
  text: string;
  rating: number;
}

/**
 * Creates a user (if needed), an owned target, and persisted reviews in the test
 * database. Give each dataset a distinctive phrase so tests can prove it never
 * reaches the wrong question's model context.
 */
export async function seedTargetWithReviews(
  clerkUserId: string,
  name: string,
  reviews: readonly SeedReview[],
) {
  const owner = await users.findOrCreate(clerkUserId);
  const target = await targets.create(owner.id, {
    name,
    platform: 'GOOGLE_MAPS',
    sourceUrl: `https://maps.google.com/?cid=${Math.floor(Math.random() * 1e12)}`,
  });
  await testPrisma.review.createMany({
    data: reviews.map((review) => ({
      targetId: target.id,
      text: review.text,
      rating: review.rating,
    })),
  });
  const saved = await testPrisma.review.findMany({ where: { targetId: target.id } });
  return { ownerId: owner.id, target, reviewIds: saved.map((review) => review.id) };
}
