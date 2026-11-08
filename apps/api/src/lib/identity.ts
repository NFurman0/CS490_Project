import type { Request, RequestHandler } from 'express';
import { AppError } from './errors.js';

/** An identity verified by the managed identity provider (docs/security-guardrails.md §1). */
export interface VerifiedIdentity {
  clerkUserId: string;
}

/**
 * The authenticated caller, set by `requireUser`.
 */
export interface AuthenticatedUser {
  id: string;
  clerkUserId: string;
}

/**
 * Where the API gets verified identities from. Production uses Clerk
 * (adapters/clerk); tests inject a fake (test/helpers).
 */
export interface IdentityProvider {
  /** Middleware that must run before `resolve`, such as Clerk's token verification. */
  readonly middleware: RequestHandler[];
  /** Returns the verified identity, or null when the request has no valid session. */
  resolve(req: Request): VerifiedIdentity | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Returns the authenticated caller. Only valid in routes behind `requireUser`;
 * anywhere else it fails closed instead of running without an identity.
 */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw new AppError('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
  }
  return req.user;
}
