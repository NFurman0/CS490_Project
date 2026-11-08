import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { currentUser } from '../../src/lib/identity.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createTestApp } from '../helpers/test-app.js';
import { hasTestDatabase, resetDatabase, testPrisma } from '../helpers/test-database.js';

const users = createUsersRepository(testPrisma);
const targets = createTargetsRepository(testPrisma);

/**
 * A minimal create route that follows the required pattern: the owner comes from
 * `currentUser(req).id`, and the data object is built field by field from the body
 */
const createTargetRoute = Router().post('/', async (req, res) => {
  const target = await targets.create(currentUser(req).id, {
    name: String(req.body.name),
    platform: 'GOOGLE_MAPS',
    sourceUrl: String(req.body.sourceUrl),
  });
  res.status(201).json({ data: { id: target.id } });
});

function appFor(clerkUserId: string) {
  return createTestApp({
    as: clerkUserId,
    users,
    extraRouters: [{ path: '/probe-targets', router: createTargetRoute }],
  });
}

describe.skipIf(!hasTestDatabase)('ownership from authenticated identity (database)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('creates the internal user on the first authenticated request', async () => {
    await request(appFor('clerk_first_visit')).get('/api/session').expect(200);

    const user = await testPrisma.user.findUnique({ where: { clerkUserId: 'clerk_first_visit' } });
    expect(user).not.toBeNull();
  });

  it('reuses one internal user per Clerk user', async () => {
    const first = await users.findOrCreate('clerk_a');
    const second = await users.findOrCreate('clerk_a');

    expect(second.id).toBe(first.id);
    expect(await testPrisma.user.count({ where: { clerkUserId: 'clerk_a' } })).toBe(1);
  });

  it('creates exactly one user when first requests arrive at the same time', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => users.findOrCreate('clerk_concurrent')),
    );

    expect(new Set(results.map((user) => user.id)).size).toBe(1);
    expect(await testPrisma.user.count({ where: { clerkUserId: 'clerk_concurrent' } })).toBe(1);
  });

  it('gives different Clerk users different internal users', async () => {
    const a = await users.findOrCreate('clerk_a');
    const b = await users.findOrCreate('clerk_b');

    expect(a.id).not.toBe(b.id);
  });

  it('owns a created record by the signed-in user, ignoring owner fields sent by the client', async () => {
    const userB = await users.findOrCreate('clerk_b');

    const res = await request(appFor('clerk_a'))
      .post('/api/probe-targets')
      .send({
        name: "Joe's Pizza",
        sourceUrl: 'https://maps.google.com/?cid=123456',
        ownerId: userB.id,
        userId: userB.id,
      })
      .expect(201);

    const userA = await testPrisma.user.findUniqueOrThrow({ where: { clerkUserId: 'clerk_a' } });
    const saved = await testPrisma.analysisTarget.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(saved.ownerId).toBe(userA.id);
    expect(await testPrisma.analysisTarget.count({ where: { ownerId: userB.id } })).toBe(0);
  });
});
