import { type PrismaClient, type ReviewPlatform } from '@prisma/client';

export interface NewAnalysisTarget {
  name: string;
  platform: ReviewPlatform;
  sourceUrl: string;
}

export function createTargetsRepository(prisma: Pick<PrismaClient, 'analysisTarget'>) {
  return {
    create(ownerId: string, target: NewAnalysisTarget) {
      return prisma.analysisTarget.create({
        data: {
          ownerId,
          name: target.name,
          platform: target.platform,
          sourceUrl: target.sourceUrl,
        },
      });
    },

    findById(ownerId: string, targetId: string) {
      return prisma.analysisTarget.findFirst({
        where: { id: targetId, ownerId },
      });
    },

    findMany(ownerId: string, take?: number) {
      return prisma.analysisTarget.findMany({
        where: { ownerId },
        orderBy: { createdAt: 'desc' },
        ...(take === undefined ? {} : { take }),
      });
    },
  };
}
