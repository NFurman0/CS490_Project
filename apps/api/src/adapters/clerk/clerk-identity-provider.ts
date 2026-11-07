import { clerkMiddleware, getAuth } from '@clerk/express';
import type { RequestHandler } from 'express';
import type { IdentityProvider } from '../../lib/identity.js';
import type { Logger } from '../../lib/logger.js';

export interface ClerkIdentityConfig {
  secretKey: string;
  publishableKey: string;
  /** Origins allowed to have issued the session token, e.g. the web app's origin. */
  authorizedParties: string[];
  logger: Logger;
}

/**
 * Clerk adds x-clerk-auth-* headers explaining why authentication failed.
 * Remove them so clients only see our standard error envelope.
 */
export const stripClerkAuthHeaders: RequestHandler = (_req, res, next) => {
  for (const name of res.getHeaderNames()) {
    if (name.startsWith('x-clerk-auth-')) res.removeHeader(name);
  }
  next();
};

/**
 * Verifies Clerk session tokens (from the Authorization header or session cookie)
 * and exposes the Clerk user ID. Keys come from validated config, never process.env.
 * Clerk's requireAuth() is not used: it redirects instead of returning 401.
 */
export function createClerkIdentityProvider(config: ClerkIdentityConfig): IdentityProvider {
  return {
    middleware: [
      clerkMiddleware({
        secretKey: config.secretKey,
        publishableKey: config.publishableKey,
        authorizedParties: config.authorizedParties,
      }),
      stripClerkAuthHeaders,
    ],
    resolve(req) {
      const auth = getAuth(req);
      if (auth.isAuthenticated) return { clerkUserId: auth.userId };

      // A token was sent but rejected: log Clerk's reason (never the token itself)
      // so a misconfiguration is diagnosable from the server log.
      if (req.headers.authorization) {
        const { reason, message } = auth.debug();
        config.logger.warn({ reason, message }, 'Clerk rejected the session token');
      }
      return null;
    },
  };
}
