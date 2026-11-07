import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PrismaClient, ReviewPlatform } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';

const testEnvPath = existsSync('.env.test') ? '.env.test' : 'apps/api/.env.test';
if (existsSync(testEnvPath)) {
  delete process.env.DATABASE_URL;
  process.loadEnvFile(testEnvPath);
}

const databaseUrl = process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: {
    db: { url: databaseUrl ?? 'postgresql://reviewlens:reviewlens@localhost:5433/reviewlens_test' },
  },
});
const targetsRepository = createTargetsRepository(prisma);

describe.skipIf(!databaseUrl)('AnalysisTarget persistence', () => {
  let ownerAId: string;
  let ownerBId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.analysisTarget.deleteMany();
    await prisma.user.deleteMany();
    const [ownerA, ownerB] = await Promise.all([
      prisma.user.create({ data: { clerkUserId: `clerk-${randomUUID()}` } }),
      prisma.user.create({ data: { clerkUserId: `clerk-${randomUUID()}` } }),
    ]);
    ownerAId = ownerA.id;
    ownerBId = ownerB.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists required fields and returns a target only for its owner', async () => {
    const target = await targetsRepository.create(ownerAId, {
      name: "Joe's Pizza",
      platform: ReviewPlatform.GOOGLE_MAPS,
      sourceUrl: 'https://maps.google.com/?cid=123456',
    });

    await expect(targetsRepository.findById(ownerAId, target.id)).resolves.toMatchObject({
      id: target.id,
      ownerId: ownerAId,
      name: "Joe's Pizza",
      platform: ReviewPlatform.GOOGLE_MAPS,
      sourceUrl: 'https://maps.google.com/?cid=123456',
      createdAt: expect.any(Date),
    });
    await expect(targetsRepository.findById(ownerBId, target.id)).resolves.toBeNull();
    expect(await prisma.analysisTarget.count()).toBe(1);
  });

  it('rejects empty required values and a target with no valid owner', async () => {
    const baseTarget = {
      ownerId: ownerAId,
      platform: ReviewPlatform.GOOGLE_MAPS,
      sourceUrl: 'https://maps.google.com/?cid=123456',
    };

    await expect(
      prisma.analysisTarget.create({ data: { ...baseTarget, name: '   ' } }),
    ).rejects.toThrow();
    await expect(
      prisma.analysisTarget.create({
        data: { ...baseTarget, name: "Joe's Pizza", sourceUrl: '  ' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.analysisTarget.create({
        data: {
          ...baseTarget,
          ownerId: randomUUID(),
          name: "Joe's Pizza",
        },
      }),
    ).rejects.toThrow();

    expect(await prisma.analysisTarget.count()).toBe(0);
  });
});
