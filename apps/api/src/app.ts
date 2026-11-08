import cors from 'cors';
import express, { Router, type Express } from 'express';
import type { IdentityProvider } from './lib/identity.js';
import type { Logger } from './lib/logger.js';
import type { ReviewSource } from './modules/ingestion/review-source.js';
import type { UsersRepository } from './modules/users/users.repository.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { requireUser } from './middleware/require-user.js';
import { healthRouter } from './modules/health/health.routes.js';
import { sessionRouter } from './modules/session/session.routes.js';

export interface AppDependencies {
  logger: Logger;
  webOrigin: string;
  identity: IdentityProvider;
  usersRepository: UsersRepository;
  /** Where ingestion gets reviews from (SerpApi in production, a fake in tests). Used from S1-019. */
  reviewSource?: ReviewSource;
  /** Extra protected routers mounted under /api. Feature routers are added here as stories land. */
  extraRouters?: { path: string; router: Router }[];
}

/** Builds the Express app without starting a server, so tests can use it directly. */
export function createApp({
  logger,
  webOrigin,
  identity,
  usersRepository,
  extraRouters = [],
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(cors({ origin: webOrigin }));
  app.use(express.json({ limit: '100kb' }));

  // Public: the only route that does not require a session.
  app.use('/api/health', healthRouter);

  // Protected: everything else under /api requires a verified session.
  const api = Router();
  for (const middleware of identity.middleware) api.use(middleware);
  api.use(requireUser(identity, usersRepository));
  api.use('/session', sessionRouter);
  for (const { path, router } of extraRouters) api.use(path, router);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
