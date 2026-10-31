import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { verifyJWT } from '../lib/jwt';

export async function requireAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJWT<{ sub: string }>(token, c.env.JWT_SECRET);
  if (!payload?.sub) return c.json({ error: 'Invalid or expired token' }, 401);

  c.set('userId', payload.sub);
  await next();
}
