import { Router } from 'express';

/** Public liveness check. Returns no user data (docs/security-guardrails.md §4.1). */
export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ data: { status: 'ok' } });
});
