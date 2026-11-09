import type {
  IngestionRun,
  IngestionRunErrorCode,
  IngestionRunStatus,
  PrismaClient,
} from '@prisma/client';

export interface FinishedRun {
  status: Exclude<IngestionRunStatus, 'RUNNING'>;
  errorCode: IngestionRunErrorCode | null;
  reviewCount: number;
}

export interface IngestionRunsRepository {
  start(targetId: string): Promise<IngestionRun>;
  finish(runId: string, outcome: FinishedRun): Promise<IngestionRun>;
  findLatest(targetId: string): Promise<IngestionRun | null>;
}

/**
 * Database access for IngestionRun. Runs are owned through their target, so callers
 * must pass a target ID that already passed the ownership check
 * (docs/security-guardrails.md §4.3). `finish` only takes a run ID returned by
 * `start` in the same request, never one read from the client.
 */
export function createIngestionRunsRepository(
  prisma: Pick<PrismaClient, 'ingestionRun'>,
): IngestionRunsRepository {
  return {
    start(targetId) {
      return prisma.ingestionRun.create({
        data: { targetId, status: 'RUNNING' },
      });
    },

    finish(runId, { status, errorCode, reviewCount }) {
      return prisma.ingestionRun.update({
        where: { id: runId },
        data: { status, errorCode, reviewCount, completedAt: new Date() },
      });
    },

    findLatest(targetId) {
      return prisma.ingestionRun.findFirst({
        where: { targetId },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      });
    },
  };
}
