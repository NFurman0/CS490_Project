import { Router } from 'express';
import { currentUser } from '../../lib/identity.js';

/**
 * Lets the web app confirm the API accepts its session.
 */
export const sessionRouter = Router();

sessionRouter.get('/', (req, res) => {
  currentUser(req);
  res.json({ data: { authenticated: true } });
});
