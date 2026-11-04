import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Gives every request an ID that appears in logs and error responses. */
export const requestId: RequestHandler = (_req, res, next) => {
  res.locals.requestId = randomUUID();
  next();
};
