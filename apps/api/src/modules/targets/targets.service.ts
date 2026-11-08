import { ReviewPlatform, type AnalysisTarget } from '@prisma/client';
import type { CreateAnalysisTargetInput } from '@reviewlens/shared';
import { AppError } from '../../lib/errors.js';
import type { NewAnalysisTarget } from './targets.repository.js';

export interface TargetsRepository {
  create(ownerId: string, target: NewAnalysisTarget): Promise<AnalysisTarget>;
}

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
  };
}
