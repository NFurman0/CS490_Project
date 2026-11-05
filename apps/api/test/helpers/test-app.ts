import type { Router } from 'express';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';

/** Builds the app for tests with a silent logger. Lives outside src/, so it is never deployed. */
export function createTestApp(extraRouters: { path: string; router: Router }[] = []) {
  return createApp({
    logger: createLogger('silent'),
    webOrigin: 'http://localhost:5173',
    extraRouters,
  });
}
