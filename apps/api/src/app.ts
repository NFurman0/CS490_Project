import cors from 'cors';
import express, { type Express, type Router } from 'express';
import type { Logger } from './lib/logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { healthRouter } from './modules/health/health.routes.js';

export interface AppDependencies {
  logger: Logger;
  webOrigin: string;
  /** Extra routers mounted under /api. Feature routers are added here as stories land. */
  extraRouters?: { path: string; router: Router }[];
}

/** Builds the Express app without starting a server, so tests can use it directly. */
export function createApp({ logger, webOrigin, extraRouters = [] }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(cors({ origin: webOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter);
  for (const { path, router } of extraRouters) app.use(`/api${path}`, router);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
