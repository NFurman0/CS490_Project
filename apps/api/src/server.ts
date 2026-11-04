import { existsSync } from 'node:fs';
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
const app = createApp({ logger, webOrigin: env.WEB_ORIGIN });

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'ReviewLens API listening');
});
