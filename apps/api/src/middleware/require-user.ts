import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import type { IdentityProvider, UserDirectory } from '../lib/identity.js';

/**
 * Rejects requests without a verified session (401, no data). For verified
 * requests, maps the Clerk identity to the internal user (creating it on first
 * sign-in) and sets `req.user`. Mounted once on the /api router, so every route
 * added there is protected by default.
 * Ownership comes only from here (`req.user.id` is derived from the verified
 * token, never from anything the client sends).
 */
export function requireUser(identity: IdentityProvider, users: UserDirectory): RequestHandler {
  return async (req, _res, next) => {
    const verified = identity.resolve(req);
    if (!verified) {
      next(new AppError('UNAUTHENTICATED', 'Sign in to continue.'));
      return;
    }
    const user = await users.findOrCreate(verified.clerkUserId);
    req.user = { id: user.id, clerkUserId: verified.clerkUserId };
    next();
  };
}
