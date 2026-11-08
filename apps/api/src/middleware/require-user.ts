import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import type { IdentityProvider } from '../lib/identity.js';
import type { UsersRepository } from '../modules/users/users.repository.js';

/**
 * Rejects requests without a verified session (401, no data) and sets `req.user`
 * from the identity provider. Mounted once on the /api router, so every route
 * added there is protected by default.
 */
export function requireUser(
  identity: IdentityProvider,
  usersRepository: UsersRepository,
): RequestHandler {
  return async (req, _res, next) => {
    const verified = identity.resolve(req);
    if (!verified) {
      next(new AppError('UNAUTHENTICATED', 'Sign in to continue.'));
      return;
    }
    const user = await usersRepository.findOrCreateByClerkUserId(verified.clerkUserId);
    req.user = { id: user.id, clerkUserId: verified.clerkUserId };
    next();
  };
}
