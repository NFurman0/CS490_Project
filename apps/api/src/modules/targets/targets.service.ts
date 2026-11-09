import { ReviewPlatform, type AnalysisTarget } from '@prisma/client';
import type { CreateAnalysisTargetInput } from '@reviewlens/shared';
import { AppError } from '../../lib/errors.js';
import { getOwnedTargetOrThrow, type OwnedTargetLookup } from './owned-target.js';
import type { NewAnalysisTarget } from './targets.repository.js';

export interface TargetsRepository extends OwnedTargetLookup {
  create(ownerId: string, target: NewAnalysisTarget): Promise<AnalysisTarget>;
  findById(ownerId: string, targetId: string): Promise<AnalysisTarget | null>;
  deleteById(ownerId: string, targetId: string): Promise<{ count: number }>;
  findMany(ownerId: string, take?: number): Promise<AnalysisTarget[]>;
}

const RECENT_TARGET_LIMIT = 5;

export interface CreateTargetsServiceOptions {
  repository: TargetsRepository;
  validateSourceUrl: (sourceUrl: string) => Promise<boolean>;
}

export function createTargetsService({
  repository,
  validateSourceUrl,
}: CreateTargetsServiceOptions) {
  return {
    async create(ownerId: string, target: CreateAnalysisTargetInput) {
      if (!(await validateSourceUrl(target.sourceUrl))) {
        throw new AppError('VALIDATION_FAILED', 'Please check the highlighted fields.', {
          fieldErrors: { sourceUrl: ['Enter a Google Maps place or share link.'] },
        });
      }

      return repository.create(ownerId, {
        name: target.name,
        platform: ReviewPlatform.GOOGLE_MAPS,
        sourceUrl: target.sourceUrl,
      });
    },

    list(ownerId: string) {
      return repository.findMany(ownerId);
    },

    listRecent(ownerId: string) {
      return repository.findMany(ownerId, RECENT_TARGET_LIMIT);
    },

    async getOwned(ownerId: string, targetId: string) {
      const target = await repository.findById(ownerId, targetId);
      if (!target) throw new AppError('NOT_FOUND', 'Analysis target not found.');
      return target;
    },

    async deleteOwned(ownerId: string, targetId: string) {
      const result = await repository.deleteById(ownerId, targetId);
      if (result.count === 0) throw new AppError('NOT_FOUND', 'Analysis target not found.');
    },

    /** The owned target, or `NOT_FOUND`. See owned-target.ts. */
    getOwnedTargetOrThrow(ownerId: string, targetId: string | undefined) {
      return getOwnedTargetOrThrow(repository, ownerId, targetId);
    },
  };
}
