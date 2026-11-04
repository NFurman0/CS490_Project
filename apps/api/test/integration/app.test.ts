import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/lib/errors.js';
import { createTestApp } from '../helpers/test-app.js';

// Routes that exist only in this test, to exercise the error handler.
const probe = Router();
probe.get('/app-error', () => {
  throw new AppError('CONFLICT', 'An ingestion run is already in progress.');
});
probe.post('/validated', (req) => {
  z.object({ name: z.string().min(1) }).parse(req.body);
});
probe.get('/crash', () => {
  throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
});

const app = createTestApp([{ path: '/probe', router: probe }]);

describe('GET /api/health', () => {
  it('returns ok without authentication', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });
});

describe('error handling', () => {
  it('returns the NOT_FOUND envelope for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it('maps an AppError to its status, code, and user-safe message', async () => {
    const res = await request(app).get('/api/probe/app-error');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'An ingestion run is already in progress.',
    });
  });

  it('maps a ZodError to VALIDATION_FAILED with field errors', async () => {
    const res = await request(app).post('/api/probe/validated').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fieldErrors).toHaveProperty('name');
  });

  it('never exposes internal error text for unexpected errors', async () => {
    const res = await request(app).get('/api/probe/crash');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('stack');
  });
});
