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
});
