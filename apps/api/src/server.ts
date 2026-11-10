import { existsSync } from 'node:fs';
import { createClerkIdentityProvider } from './adapters/clerk/clerk-identity-provider.js';
import {
  DEFAULT_SOURCE_RESOLUTION_TIMEOUT_MS,
  resolvePlaceRef,
} from './adapters/serpapi/place-url.js';
import { createSerpApiReviewSource } from './adapters/serpapi/serpapi-review-source.js';
import { createApp } from './app.js';
import { ConfigError, loadEnv, type Env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { createIngestionRunsRepository } from './modules/ingestion/ingestion-runs.repository.js';
import {
  createIngestionRouter,
  INGESTION_RUNS_PATH,
} from './modules/ingestion/ingestion.routes.js';
import { createIngestionService } from './modules/ingestion/ingestion.service.js';
import { createReviewsRepository } from './modules/reviews/reviews.repository.js';
import { createReviewsRouter, REVIEWS_PATH } from './modules/reviews/reviews.routes.js';
import { createReviewsService } from './modules/reviews/reviews.service.js';
import { createTargetsRouter } from './modules/targets/targets.routes.js';
import { createTargetsRepository } from './modules/targets/targets.repository.js';
import { createTargetsService } from './modules/targets/targets.service.js';
import { createUsersRepository } from './modules/users/users.repository.js';

if (existsSync('.env')) process.loadEnvFile('.env');

function readConfig(): Env {
  try {
    return loadEnv(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`\n${error.message}\n\n`);
      process.exit(1);
    }
    throw error;
  }
}

const env = readConfig();
const logger = createLogger(env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);
const identity = createClerkIdentityProvider({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  authorizedParties: [env.WEB_ORIGIN],
  logger,
});
const users = createUsersRepository(prisma);
const reviewSource = createSerpApiReviewSource({ apiKey: env.SERPAPI_API_KEY, logger });
const targetsRepository = createTargetsRepository(prisma);
const reviewsRepository = createReviewsRepository(prisma);
const targetsService = createTargetsService({
  repository: targetsRepository,
  validateSourceUrl: async (sourceUrl) =>
    (await resolvePlaceRef(sourceUrl, {
      fetchFn: fetch,
      timeoutMs: DEFAULT_SOURCE_RESOLUTION_TIMEOUT_MS,
    })) !== null,
});
const ingestionService = createIngestionService({
  targets: targetsRepository,
  runs: createIngestionRunsRepository(prisma),
  reviews: reviewsRepository,
  reviewSource,
  maxReviewsPerRun: env.MAX_REVIEWS_PER_RUN,
  logger,
});
const app = createApp({
  logger,
  webOrigin: env.WEB_ORIGIN,
  identity,
  users,
  extraRouters: [
    { path: '/analysis-targets', router: createTargetsRouter(targetsService) },
    { path: INGESTION_RUNS_PATH, router: createIngestionRouter(ingestionService) },
    {
      path: REVIEWS_PATH,
      router: createReviewsRouter(createReviewsService(targetsRepository, reviewsRepository)),
    },
  ],
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'ReviewLens API listening');
});

// Close the HTTP server and database connections cleanly on Ctrl+C or a restart.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
