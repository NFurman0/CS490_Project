import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { currentUser, type UserDirectory } from '../../src/lib/identity.js';
import { createTestApp, fakeUserDirectory } from '../helpers/test-app.js';

// No database needed: these tests use an in-memory user directory.

const whoAmI = Router().get('/', (req, res) => {
  res.json({ data: { userId: currentUser(req).id } });
});

describe('mapping verified identities to internal users', () => {
  it('gives protected routes the internal user ID for the signed-in Clerk user', async () => {
    const users = fakeUserDirectory();
    const expected = await users.findOrCreate('user_a');

    const res = await request(
      createTestApp({ as: 'user_a', users, extraRouters: [{ path: '/whoami', router: whoAmI }] }),
    ).get('/api/whoami');

    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(expected.id);
  });

  it('resolves the same Clerk user to the same internal user on every request', async () => {
    const users = fakeUserDirectory();
    const app = createTestApp({
      as: 'user_a',
      users,
      extraRouters: [{ path: '/whoami', router: whoAmI }],
    });

    const first = await request(app).get('/api/whoami');
    const second = await request(app).get('/api/whoami');

    expect(second.body.data.userId).toBe(first.body.data.userId);
  });

  it('never creates a user record for a signed-out request', async () => {
    const findOrCreate = vi.fn<UserDirectory['findOrCreate']>();

    const res = await request(createTestApp({ as: null, users: { findOrCreate } })).get(
      '/api/session',
    );

    expect(res.status).toBe(401);
    expect(findOrCreate).not.toHaveBeenCalled();
  });

  it('returns a generic 500 without internal details when the user lookup fails', async () => {
    const users: UserDirectory = {
      findOrCreate: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432 password=hunter2');
      },
    };

    const res = await request(createTestApp({ as: 'user_a', users })).get('/api/session');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
