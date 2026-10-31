import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';

const users = new Hono<{ Bindings: Env; Variables: Variables }>();
users.use('*', requireAuth);

const ONLINE_THRESHOLD_MS = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function profilePublic(row: any, lastActiveAt?: number | null) {
  const isOnline = !!lastActiveAt && Date.now() - lastActiveAt < ONLINE_THRESHOLD_MS;
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    username: row.username ?? undefined,
    username_last_changed: row.username_last_changed ?? undefined,
    avatar_url: row.avatar_url ?? undefined,
    bio: row.bio ?? undefined,
    is_admin: !!row.is_admin,
    created_at: row.created_at,
    is_online: isOnline,
    last_seen: lastActiveAt ? new Date(lastActiveAt).toISOString() : undefined,
  };
}

async function getPresence(env: Env, userId: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT last_active_at FROM presence WHERE user_id = ?')
    .bind(userId)
    .first<{ last_active_at: number }>();
  return row?.last_active_at ?? null;
}

users.get('/me', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('userId')).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  const lastActiveAt = await getPresence(c.env, c.get('userId'));
  return c.json({ profile: profilePublic(row, lastActiveAt) });
});

users.patch('/me', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const userId = c.get('userId');
  const fields: string[] = [];
  const values: unknown[] = [];

  if (typeof body.full_name === 'string') {
    fields.push('full_name = ?');
    values.push(body.full_name.trim());
  }
  if (typeof body.bio === 'string') {
    fields.push('bio = ?');
    values.push(body.bio.trim());
  }
  if (typeof body.avatar_url === 'string') {
    fields.push('avatar_url = ?');
    values.push(body.avatar_url);
  }
  if (typeof body.username === 'string') {
    const username = body.username.trim().toLowerCase();
    const taken = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .bind(username, userId)
      .first();
    if (taken) return c.json({ error: 'Username already taken' }, 409);
    fields.push('username = ?', 'username_last_changed = ?');
    values.push(username, new Date().toISOString());
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  values.push(userId);
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return c.json({ profile: profilePublic(row) });
});

users.get('/username-available', async (c) => {
  const username = (c.req.query('username') || '').trim().toLowerCase();
  if (!username) return c.json({ available: false });
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?')
    .bind(username, c.get('userId'))
    .first();
  return c.json({ available: !row });
});

users.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  const lastActiveAt = await getPresence(c.env, id);
  return c.json({ profile: profilePublic(row, lastActiveAt) });
});

// All profiles except me + blocked users — used for Discover "suggestions".
users.get('/', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT u.* FROM users u
     WHERE u.id != ?
       AND u.id NOT IN (SELECT blocked_user_id FROM blocked_users WHERE user_id = ?)
       AND u.id NOT IN (SELECT user_id FROM blocked_users WHERE blocked_user_id = ?)
     ORDER BY u.created_at DESC
     LIMIT 100`
  )
    .bind(userId, userId, userId)
    .all();
  return c.json({ profiles: results?.map((r) => profilePublic(r)) ?? [] });
});

users.post('/presence', async (c) => {
  const userId = c.get('userId');
  await c.env.DB.prepare(
    `INSERT INTO presence (user_id, last_active_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_active_at = excluded.last_active_at`
  )
    .bind(userId, Date.now())
    .run();
  return c.json({ success: true });
});

export default users;
