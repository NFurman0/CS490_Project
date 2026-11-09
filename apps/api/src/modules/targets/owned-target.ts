import type { AnalysisTarget } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

/** The lookup the guard needs. `findById` must filter by owner (targets.repository.ts does). */
export interface OwnedTargetLookup {
  findById(ownerId: string, targetId: string): Promise<AnalysisTarget | null>;
}

const targetIdSchema = z.uuid();

/**
 * Returns the target only if `ownerId` owns it (S1-013, docs/security-guardrails.md §4.3).
 *
 * Every operation on a target's child records (ingestion runs, reviews) must call this
 * first, with `ownerId` from `currentUser(req).id`, and use the returned target's `id`
 * from then on instead of the raw request value.
 *
 * A malformed ID, an unknown ID and another user's target all throw the same
 * `NOT_FOUND`, so a caller can't tell whether a target exists (§4.4). A malformed ID
 * never reaches the database's UUID column.
 */
export async function getOwnedTargetOrThrow(
  lookup: OwnedTargetLookup,
  ownerId: string,
  targetId: string | undefined,
): Promise<AnalysisTarget> {
  const parsed = targetIdSchema.safeParse(targetId);
  const target = parsed.success ? await lookup.findById(ownerId, parsed.data) : null;
  if (!target) {
    throw new AppError('NOT_FOUND', 'Analysis target not found.');
  }
  return target;
}
