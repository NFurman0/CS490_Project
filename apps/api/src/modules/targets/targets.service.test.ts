import { ReviewPlatform } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createTargetsService } from './targets.service.js';

const validTarget = {
  name: "Joe's Pizza",
  sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
};

function createService(validateSourceUrl: (sourceUrl: string) => Promise<boolean>) {
  const repository = {
    create: vi.fn(
      async (
        _ownerId: string,
        target: { name: string; platform: ReviewPlatform; sourceUrl: string },
      ) => ({
        id: 'target-id',
        ownerId: 'owner-id',
        ...target,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ),
    findMany: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    deleteById: vi.fn(async () => ({ count: 0 })),
  };
  return { service: createTargetsService({ repository, validateSourceUrl }), repository };
}

describe('createTargetsService', () => {
  it('validates the source and assigns the supported review platform', async () => {
    const validateSourceUrl = vi.fn(async () => true);
    const { service, repository } = createService(validateSourceUrl);

    await service.create('owner-id', validTarget);

    expect(validateSourceUrl).toHaveBeenCalledWith(validTarget.sourceUrl);
    expect(repository.create).toHaveBeenCalledWith('owner-id', {
      ...validTarget,
      platform: ReviewPlatform.GOOGLE_MAPS,
    });
  });

  it('rejects unsupported Google Maps URLs without persisting the target', async () => {
    const { service, repository } = createService(async () => false);

    await expect(service.create('owner-id', validTarget)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fieldErrors: { sourceUrl: ['Enter a Google Maps place or share link.'] } },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('scopes recent and full-list queries to the authenticated owner', async () => {
    const { service, repository } = createService(async () => true);

    await service.list('owner-a');
    await service.listRecent('owner-b');

    expect(repository.findMany).toHaveBeenNthCalledWith(1, 'owner-a');
    expect(repository.findMany).toHaveBeenNthCalledWith(2, 'owner-b', 5);
  });

  it('uses the owner in single-target reads and deletes', async () => {
    const { service, repository } = createService(async () => true);
    await expect(service.getOwned('owner-a', 'target-id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.deleteOwned('owner-b', 'target-id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repository.findById).toHaveBeenCalledWith('owner-a', 'target-id');
    expect(repository.deleteById).toHaveBeenCalledWith('owner-b', 'target-id');
  });
});
