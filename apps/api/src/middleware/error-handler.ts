import type { ApiErrorResponse } from '@reviewlens/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

/** Responds 404 for any route that no router handled. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'The requested resource was not found.'));
};

/** Converts every error into the standard envelope. Unknown errors are logged, never sent. */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId: string | undefined = res.locals.requestId;
    let body: ApiErrorResponse;
    let status: number;

    if (err instanceof AppError) {
      status = err.httpStatus;
      body = { error: { code: err.code, message: err.message, details: err.details, requestId } };
      if (status >= 500) logger.error({ err, requestId }, 'request failed');
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Please check the highlighted fields.',
          details: { fieldErrors: err.flatten().fieldErrors },
          requestId,
        },
      };
    } else {
      status = 500;
      body = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong on our side. Please try again.',
          requestId,
        },
      };
      logger.error({ err, requestId, method: req.method, path: req.path }, 'unhandled error');
    }

    res.status(status).json(body);
  };
}
