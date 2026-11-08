import type { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import type { IdentityProvider } from '../../src/lib/identity.js';
import { createLogger } from '../../src/lib/logger.js';
import type { ReviewSource } from '../../src/modules/ingestion/review-source.js';
import type { UsersRepository } from '../../src/modules/users/users.repository.js';

/**
 * A fake identity provider that always resolves to the given Clerk user, or to
 * no one when `null`. Lives outside src/, so it can never be part of a
 * production build.
 */
export function fakeIdentityProvider(clerkUserId: string | null): IdentityProvider {
  return {
    middleware: [],
    resolve: () => (clerkUserId ? { clerkUserId } : null),
  };
}

export interface TestAppOptions {
  /** Clerk user the app treats every request as coming from; `null` means signed out. */
  as?: string | null;
  extraRouters?: { path: string; router: Router }[];
  usersRepository?: UsersRepository;
  reviewSource?: ReviewSource;
}

/** Builds the app for tests with a silent logger and an injected identity. */
export function createTestApp({
  as = 'user_test',
  extraRouters = [],
  usersRepository = createFakeUsersRepository(),
  reviewSource,
}: TestAppOptions = {}) {
  return createApp({
    logger: createLogger('silent'),
    webOrigin: 'http://localhost:5173',
    identity: fakeIdentityProvider(as),
    usersRepository,
    reviewSource,
    extraRouters,
  });
}

function createFakeUsersRepository(): UsersRepository {
  const idsByClerkUserId = new Map<string, string>();
  return {
    async findOrCreateByClerkUserId(clerkUserId) {
      let id = idsByClerkUserId.get(clerkUserId);
      if (!id) {
        id = randomUUID();
        idsByClerkUserId.set(clerkUserId, id);
      }
      return { id };
    },
  };
}
