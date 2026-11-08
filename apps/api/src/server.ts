import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { createClerkIdentityProvider } from './adapters/clerk/clerk-identity-provider.js';
import {
  DEFAULT_SOURCE_RESOLUTION_TIMEOUT_MS,
  resolvePlaceRef,
} from './adapters/serpapi/place-url.js';
import { createSerpApiReviewSource } from './adapters/serpapi/serpapi-review-source.js';
import { createApp } from './app.js';
import { ConfigError, loadEnv, type Env } from './config/env.js';
import { createLogger } from './lib/logger.js';
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
const prisma = new PrismaClient();
const identity = createClerkIdentityProvider({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  authorizedParties: [env.WEB_ORIGIN],
  logger,
});
const reviewSource = createSerpApiReviewSource({ apiKey: env.SERPAPI_API_KEY, logger });
const usersRepository = createUsersRepository(prisma);
const targetsRepository = createTargetsRepository(prisma);
const targetsService = createTargetsService({
  repository: targetsRepository,
  validateSourceUrl: async (sourceUrl) =>
    (await resolvePlaceRef(sourceUrl, {
      fetchFn: fetch,
      timeoutMs: DEFAULT_SOURCE_RESOLUTION_TIMEOUT_MS,
    })) !== null,
});
const targetsRouter = createTargetsRouter(targetsService);
const app = createApp({
  logger,
  webOrigin: env.WEB_ORIGIN,
  identity,
  usersRepository,
  reviewSource,
  extraRouters: [{ path: '/analysis-targets', router: targetsRouter }],
});

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'ReviewLens API listening');
});
