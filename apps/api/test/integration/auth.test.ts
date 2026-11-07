import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { currentUser } from '../../src/lib/identity.js';
import { createTestApp } from '../helpers/test-app.js';

describe('authentication', () => {
  describe('GET /api/session', () => {
    it('confirms an authenticated session', async () => {
      const res = await request(createTestApp({ as: 'user_a' })).get('/api/session');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { authenticated: true } });
    });

    it('rejects a request without a session with 401 and no data', async () => {
      const res = await request(createTestApp({ as: null })).get('/api/session');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body).not.toHaveProperty('data');
    });

    it('does not reveal the Clerk user ID to the client', async () => {
      const res = await request(createTestApp({ as: 'user_a' })).get('/api/session');
      expect(JSON.stringify(res.body)).not.toContain('user_a');
    });
  });

  it('ignores client-supplied identity headers when there is no verified session', async () => {
    const res = await request(createTestApp({ as: null }))
      .get('/api/session')
      .set('x-user-id', 'user_a')
      .set('x-clerk-user-id', 'user_a');

    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('data');
  });

  it('keeps the health check public', async () => {
    const res = await request(createTestApp({ as: null })).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('protects new /api routes by default, before their handlers run', async () => {
    const handler = vi.fn((_req, res) => res.json({ data: 'secret' }));
    const router = Router().get('/', handler);

    const res = await request(
      createTestApp({ as: null, extraRouters: [{ path: '/new', router }] }),
    ).get('/api/new');

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('answers unknown /api routes with 401 when signed out, so route names are not revealed', async () => {
    const res = await request(createTestApp({ as: null })).get('/api/analysis-targets/abc');
    expect(res.status).toBe(401);
  });

  it('makes the verified identity available to protected routes', async () => {
    const router = Router().get('/', (req, res) => {
      res.json({ data: { clerkUserId: currentUser(req).clerkUserId } });
    });

    const res = await request(
      createTestApp({ as: 'user_b', extraRouters: [{ path: '/whoami', router }] }),
    ).get('/api/whoami');

    expect(res.body.data.clerkUserId).toBe('user_b');
  });
});
