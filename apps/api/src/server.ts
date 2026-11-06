import { existsSync } from 'node:fs';
import { createClerkIdentityProvider } from './adapters/clerk/clerk-identity-provider.js';
import { createApp } from './app.js';
import { ConfigError, loadEnv, type Env } from './config/env.js';
import { createLogger } from './lib/logger.js';

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
const identity = createClerkIdentityProvider({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  authorizedParties: [env.WEB_ORIGIN],
  logger,
});
const app = createApp({ logger, webOrigin: env.WEB_ORIGIN, identity });

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'ReviewLens API listening');
});
