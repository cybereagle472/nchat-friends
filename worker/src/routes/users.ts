import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { computeIsOnline, getPresence, getPresenceMap } from '../lib/presence';
import { applyPrivacy, applyPrivacyToList, areFriends, getPrivacySettings } from '../lib/privacy';

const users = new Hono<{ Bindings: Env; Variables: Variables }>();
users.use('*', requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function profilePublic(row: any, lastActiveAt?: number | null) {
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
    is_online: computeIsOnline(lastActiveAt),
    last_seen: lastActiveAt ? new Date(lastActiveAt).toISOString() : undefined,
  };
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

// Full, server-side username/name search across *every* user in the
// database — not just the most-recently-joined page the plain `GET /`
// suggestions list below is capped to. This is what every search bar in
// the app that needs to find "a specific person" (Discover's Find tab,
// and anywhere else that adds a live user-lookup) should call as the
// user types, instead of only ever being able to filter whatever users
// happened to already be loaded on the client.
//
// Registered before the `/:id` route below on purpose: Hono matches
// routes in registration order, and `/:id` is a catch-all single-segment
// pattern that would otherwise swallow `/users/search` as if `search`
// were a user id.
users.get('/search', async (c) => {
  const userId = c.get('userId');
  const qRaw = (c.req.query('q') || '').trim();
  // Also accept a leading "@" (e.g. someone typing "@muhammad" to search
  // by handle) — strip it rather than treating it as part of the query.
  const q = qRaw.startsWith('@') ? qRaw.slice(1).trim() : qRaw;
  if (!q) return c.json({ profiles: [] });

  // Escape SQL LIKE's own wildcard characters (% and _) so a query that
  // happens to literally contain them (e.g. searching for "a_b") is
  // matched as literal text instead of behaving like a wildcard pattern.
  const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const lower = q.toLowerCase();
  const escaped = escapeLike(lower);
  const containsPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 30, 1), 50);

  const { results } = await c.env.DB.prepare(
    `SELECT u.* FROM users u
     WHERE u.id != ?
       AND u.id NOT IN (SELECT blocked_user_id FROM blocked_users WHERE user_id = ?)
       AND u.id NOT IN (SELECT user_id FROM blocked_users WHERE blocked_user_id = ?)
       AND (
         LOWER(u.username) LIKE ? ESCAPE '\\'
         OR LOWER(u.full_name) LIKE ? ESCAPE '\\'
       )
     ORDER BY
       CASE
         WHEN LOWER(u.username) = ? THEN 0
         WHEN LOWER(u.username) LIKE ? ESCAPE '\\' THEN 1
         WHEN LOWER(u.full_name) LIKE ? ESCAPE '\\' THEN 2
         ELSE 3
       END,
       u.username ASC,
       u.full_name ASC
     LIMIT ?`
  )
    .bind(userId, userId, userId, containsPattern, containsPattern, lower, prefixPattern, prefixPattern, limit)
    .all();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (results ?? []) as any[];
  const presenceMap = await getPresenceMap(c.env, rows.map((r) => r.id));
  const profiles = await applyPrivacyToList(c.env, userId, rows.map((r) => profilePublic(r, presenceMap.get(r.id))));
  return c.json({ profiles });
});

users.get('/:id', async (c) => {
  const viewerId = c.get('userId');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  const lastActiveAt = await getPresence(c.env, id);
  let profile = profilePublic(row, lastActiveAt);
  if (id !== viewerId) {
    const [settings, isFriend] = await Promise.all([
      getPrivacySettings(c.env, id),
      areFriends(c.env, viewerId, id),
    ]);
    profile = applyPrivacy(profile, viewerId, settings, isFriend);
  }
  return c.json({ profile });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (results ?? []) as any[];
  const presenceMap = await getPresenceMap(c.env, rows.map((r) => r.id));
  const profiles = await applyPrivacyToList(c.env, userId, rows.map((r) => profilePublic(r, presenceMap.get(r.id))));
  return c.json({ profiles });
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
