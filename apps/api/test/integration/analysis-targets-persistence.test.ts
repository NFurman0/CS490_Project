import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PrismaClient, ReviewPlatform } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTargetsRouter } from '../../src/modules/targets/targets.routes.js';
import { createTargetsRepository } from '../../src/modules/targets/targets.repository.js';
import { createTargetsService } from '../../src/modules/targets/targets.service.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import type { ReviewSource } from '../../src/modules/ingestion/review-source.js';
import { createTestApp } from '../helpers/test-app.js';

const testEnvPath = existsSync('.env.test') ? '.env.test' : 'apps/api/.env.test';
if (existsSync(testEnvPath)) {
  delete process.env.DATABASE_URL;
  process.loadEnvFile(testEnvPath);
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && new URL(databaseUrl).pathname !== '/reviewlens_test') {
  throw new Error(
    'AnalysisTarget integration tests require the dedicated reviewlens_test database.',
  );
}
const prisma = new PrismaClient({
  datasources: {
    db: { url: databaseUrl ?? 'postgresql://reviewlens:reviewlens@localhost:5433/reviewlens_test' },
  },
});
const targetsRepository = createTargetsRepository(prisma);
const users = createUsersRepository(prisma);

const validTargetInput = {
  name: "Joe's Pizza",
  sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
};

function createTargetsApp({
  as,
  validateSourceUrl,
  fetchReviews = vi.fn<ReviewSource['fetchReviews']>(),
}: {
  as: string | null;
  validateSourceUrl: (sourceUrl: string) => Promise<boolean>;
  fetchReviews?: ReviewSource['fetchReviews'];
}) {
  const service = createTargetsService({ repository: targetsRepository, validateSourceUrl });
  return createTestApp({
    as,
    users,
    reviewSource: { fetchReviews },
    extraRouters: [{ path: '/analysis-targets', router: createTargetsRouter(service) }],
  });
}

describe.skipIf(!databaseUrl)('AnalysisTarget persistence', () => {
  let ownerAId: string;
  let ownerBId: string;
  let ownerAClerkUserId: string;
  let ownerBClerkUserId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.analysisTarget.deleteMany();
    await prisma.user.deleteMany();
    ownerAClerkUserId = `clerk-${randomUUID()}`;
    ownerBClerkUserId = `clerk-${randomUUID()}`;
    const [ownerA, ownerB] = await Promise.all([
      prisma.user.create({ data: { clerkUserId: ownerAClerkUserId } }),
      prisma.user.create({ data: { clerkUserId: ownerBClerkUserId } }),
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

  it('lists only each authenticated owner’s targets in newest-created order', async () => {
    const olderTarget = await prisma.analysisTarget.create({
      data: {
        ownerId: ownerAId,
        name: 'A older target',
        platform: ReviewPlatform.GOOGLE_MAPS,
        sourceUrl: 'https://maps.google.com/?cid=101',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const newerTarget = await prisma.analysisTarget.create({
      data: {
        ownerId: ownerAId,
        name: 'A newer target',
        platform: ReviewPlatform.GOOGLE_MAPS,
        sourceUrl: 'https://maps.google.com/?cid=102',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    });
    const userBTarget = await prisma.analysisTarget.create({
      data: {
        ownerId: ownerBId,
        name: 'B private target',
        platform: ReviewPlatform.GOOGLE_MAPS,
        sourceUrl: 'https://maps.google.com/?cid=201',
      },
    });

    const userAResponse = await request(
      createTargetsApp({
        as: ownerAClerkUserId,
        validateSourceUrl: vi.fn(async () => true),
      }),
    ).get('/api/analysis-targets');
    const userBResponse = await request(
      createTargetsApp({
        as: ownerBClerkUserId,
        validateSourceUrl: vi.fn(async () => true),
      }),
    ).get(`/api/analysis-targets?ownerId=${ownerAId}`);

    expect(userAResponse.status).toBe(200);
    expect(userAResponse.body.data.map((target: { id: string }) => target.id)).toEqual([
      newerTarget.id,
      olderTarget.id,
    ]);
    expect(userAResponse.body.data[0]).toMatchObject({
      name: 'A newer target',
      platform: 'google_maps',
      sourceUrl: 'https://maps.google.com/?cid=102',
    });
    expect(userAResponse.body.data.every((target: { ownerId?: string }) => !target.ownerId)).toBe(
      true,
    );

    expect(userBResponse.status).toBe(200);
    expect(userBResponse.body.data).toHaveLength(1);
    expect(userBResponse.body.data[0]).toMatchObject({
      id: userBTarget.id,
      name: 'B private target',
    });
    expect(JSON.stringify(userBResponse.body)).not.toContain('A older target');
    expect(JSON.stringify(userBResponse.body)).not.toContain('A newer target');
    expect(await prisma.analysisTarget.count()).toBe(3);
  });

  it('limits the recent-target endpoint to five of the owner’s newest targets', async () => {
    const targets = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        prisma.analysisTarget.create({
          data: {
            ownerId: ownerAId,
            name: `Target ${index + 1}`,
            platform: ReviewPlatform.GOOGLE_MAPS,
            sourceUrl: `https://maps.google.com/?cid=${index + 1}`,
            createdAt: new Date(`2026-01-0${index + 1}T00:00:00.000Z`),
          },
        }),
      ),
    );

    const response = await request(
      createTargetsApp({
        as: ownerAClerkUserId,
        validateSourceUrl: vi.fn(async () => true),
      }),
    ).get('/api/analysis-targets/recent');

    expect(response.status).toBe(200);
    expect(response.body.data.map((target: { id: string }) => target.id)).toEqual(
      targets
        .slice(1)
        .reverse()
        .map((target) => target.id),
    );
    expect(response.body.data).toHaveLength(5);
  });

  it('requires authentication to list targets', async () => {
    const response = await request(
      createTargetsApp({ as: null, validateSourceUrl: vi.fn(async () => true) }),
    ).get('/api/analysis-targets');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(response.body).not.toHaveProperty('data');
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

  it('creates an authenticated user target with server-assigned ownership', async () => {
    const validateSourceUrl = vi.fn(async () => true);
    const fetchReviews = vi.fn();
    const app = createTargetsApp({
      as: 'clerk-create-target-a',
      validateSourceUrl,
      fetchReviews,
    });

    const response = await request(app).post('/api/analysis-targets').send(validTargetInput);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: expect.any(String),
      name: validTargetInput.name,
      platform: 'google_maps',
      sourceUrl: validTargetInput.sourceUrl,
      createdAt: expect.any(String),
    });
    expect(response.body.data).not.toHaveProperty('ownerId');
    expect(JSON.stringify(response.body)).not.toContain('clerk-create-target-a');
    expect(validateSourceUrl).toHaveBeenCalledWith(validTargetInput.sourceUrl);
    expect(fetchReviews).not.toHaveBeenCalled();

    const owner = await prisma.user.findUnique({
      where: { clerkUserId: 'clerk-create-target-a' },
    });
    expect(owner).not.toBeNull();
    if (!owner) throw new Error('Expected the authenticated user to be persisted.');
    await expect(
      targetsRepository.findById(owner.id, response.body.data.id),
    ).resolves.toMatchObject({
      name: validTargetInput.name,
      ownerId: owner.id,
      platform: ReviewPlatform.GOOGLE_MAPS,
    });
  });

  it('rejects unsupported place URLs and leaves the database unchanged', async () => {
    const app = createTargetsApp({
      as: 'clerk-invalid-target',
      validateSourceUrl: vi.fn(async () => false),
    });

    const response = await request(app)
      .post('/api/analysis-targets')
      .send({ ...validTargetInput, sourceUrl: 'https://www.google.com/maps/search/pizza' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.fieldErrors.sourceUrl).toContain(
      'Enter a Google Maps place or share link.',
    );
    expect(JSON.stringify(response.body)).not.toContain(validTargetInput.name);
    expect(await prisma.analysisTarget.count()).toBe(0);
  });

  it('rejects missing fields, malformed URLs, and client-supplied ownership', async () => {
    const validateSourceUrl = vi.fn(async () => true);
    const app = createTargetsApp({ as: 'clerk-invalid-body', validateSourceUrl });
    const cases = [
      { body: { ...validTargetInput, name: ' ' }, field: 'name' },
      { body: { ...validTargetInput, sourceUrl: 'not-a-url' }, field: 'sourceUrl' },
      { body: { ...validTargetInput, ownerId: ownerAId }, field: 'ownerId' },
    ];

    for (const { body, field } of cases) {
      const response = await request(app).post('/api/analysis-targets').send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      if (field !== 'ownerId') {
        expect(response.body.error.details.fieldErrors[field]).toBeDefined();
      }
    }

    expect(validateSourceUrl).not.toHaveBeenCalled();
    expect(await prisma.analysisTarget.count()).toBe(0);
  });

  it('requires authentication before validating or persisting a target', async () => {
    const validateSourceUrl = vi.fn(async () => true);
    const response = await request(createTargetsApp({ as: null, validateSourceUrl }))
      .post('/api/analysis-targets')
      .send(validTargetInput);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(response.body).not.toHaveProperty('data');
    expect(validateSourceUrl).not.toHaveBeenCalled();
    expect(await prisma.analysisTarget.count()).toBe(0);
  });
});
