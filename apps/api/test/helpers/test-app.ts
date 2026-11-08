import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { createApp } from '../../src/app.js';
import type { IdentityProvider, UserDirectory } from '../../src/lib/identity.js';
import { createLogger } from '../../src/lib/logger.js';

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

/**
 * An in-memory user directory: each Clerk user gets a stable internal ID for the
 * life of the directory. Tests that need the real users table pass the Prisma
 * repository instead.
 */
export function fakeUserDirectory(): UserDirectory {
  const ids = new Map<string, string>();
  return {
    findOrCreate: async (clerkUserId) => {
      let id = ids.get(clerkUserId);
      if (!id) {
        id = randomUUID();
        ids.set(clerkUserId, id);
      }
      return { id };
    },
  };
}

export interface TestAppOptions {
  /** Clerk user the app treats every request as coming from; `null` means signed out. */
  as?: string | null;
  /** Maps Clerk users to internal users. Defaults to an in-memory fake (no database). */
  users?: UserDirectory;
  extraRouters?: { path: string; router: Router }[];
}

/** Builds the app for tests with a silent logger and an injected identity. */
export function createTestApp({
  as = 'user_test',
  users = fakeUserDirectory(),
  extraRouters = [],
}: TestAppOptions = {}) {
  return createApp({
    logger: createLogger('silent'),
    webOrigin: 'http://localhost:5173',
    identity: fakeIdentityProvider(as),
    users,
    extraRouters,
  });
}
