import type { AnalysisTarget } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { getOwnedTargetOrThrow } from './owned-target.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

const target: AnalysisTarget = {
  id: TARGET_ID,
  ownerId: OWNER_ID,
  name: "Joe's Pizza",
  platform: 'GOOGLE_MAPS',
  sourceUrl: 'https://maps.google.com/?cid=123456',
  createdAt: new Date('2026-11-01T00:00:00Z'),
};

function lookupReturning(found: AnalysisTarget | null) {
  return { findById: vi.fn(async () => found) };
}

describe('getOwnedTargetOrThrow', () => {
  it('returns the target when the owner lookup finds it', async () => {
    const lookup = lookupReturning(target);

    await expect(getOwnedTargetOrThrow(lookup, OWNER_ID, TARGET_ID)).resolves.toBe(target);
    expect(lookup.findById).toHaveBeenCalledWith(OWNER_ID, TARGET_ID);
  });

  it('throws NOT_FOUND when the target is missing or owned by someone else', async () => {
    const lookup = lookupReturning(null);

    await expect(getOwnedTargetOrThrow(lookup, OWNER_ID, TARGET_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });

  it.each([
    ['not a UUID', 'not-a-uuid'],
    ['empty', ''],
    ['missing', undefined],
  ])('throws NOT_FOUND without a database lookup when the ID is %s', async (_label, id) => {
    const lookup = lookupReturning(target);

    await expect(getOwnedTargetOrThrow(lookup, OWNER_ID, id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(lookup.findById).not.toHaveBeenCalled();
  });
});
