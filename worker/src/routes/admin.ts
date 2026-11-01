import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { ONLINE_THRESHOLD_MS } from '../lib/presence';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();
admin.use('*', requireAuth);

// Mirrors the admin gate the frontend already uses (Settings.tsx) — kept as
// the same hardcoded address rather than switching to the `is_admin` column
// so behavior for the existing admin account doesn't change.
const ADMIN_EMAIL = 'kazmiinasir6@gmail.com';

// GET /admin/stats — lightweight counts for the in-app admin panel. Never
// trust a client-supplied "I'm an admin" flag: look the caller's own email
// up from their authenticated user id and check it server-side.
admin.get('/stats', async (c) => {
  const userId = c.get('userId');
  const me = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (!me || me.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const onlineSince = Date.now() - ONLINE_THRESHOLD_MS;
  const [users, online, messages, groups] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM presence WHERE last_active_at > ?').bind(onlineSince).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM groups').first<{ n: number }>(),
  ]);

  return c.json({
    totalUsers: users?.n ?? 0,
    onlineUsers: online?.n ?? 0,
    totalMessages: messages?.n ?? 0,
    totalGroups: groups?.n ?? 0,
  });
});

export default admin;
