import { pino, type Logger } from 'pino';
import type { Env } from '../config/env.js';

/**
 * Paths that must never appear in logs (docs/security-guardrails.md §7).
 * Add new sensitive paths here as they are introduced.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.apiKey',
  '*.api_key',
  '*.secretKey',
  '*.CLERK_SECRET_KEY',
  '*.SERPAPI_API_KEY',
  '*.DATABASE_URL',
];

export function createLogger(level: Env['LOG_LEVEL']): Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } });
}

export type { Logger };
