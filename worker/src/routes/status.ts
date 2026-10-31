import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';

const status = new Hono<{ Bindings: Env; Variables: Variables }>();
status.use('*', requireAuth);

status.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const id = newId();
  const created_at = nowIso();
  const expires_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO statuses (id, user_id, content_type, content_url, text_content, background_color, font_style, caption, privacy, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      userId,
      body.content_type ?? 'text',
      body.content_url ?? null,
      body.text_content ?? null,
      body.background_color ?? null,
      body.font_style ?? null,
      body.caption ?? null,
      body.privacy ?? 'contacts',
      created_at,
      expires_at
    )
    .run();

  return c.json({ id, created_at, expires_at }, 201);
});

status.get('/mine', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM statuses WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC`
  )
    .bind(userId)
    .all();
  return c.json({ statuses: results ?? [] });
});

// Statuses from friends, grouped by user.
status.get('/feed', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, u.full_name, u.username, u.avatar_url FROM statuses s
     JOIN users u ON u.id = s.user_id
     JOIN friendships f ON (f.user1_id = ? AND f.user2_id = s.user_id) OR (f.user2_id = ? AND f.user1_id = s.user_id)
     WHERE s.expires_at > datetime('now')
     ORDER BY s.created_at DESC`
  )
    .bind(userId, userId)
    .all();
  return c.json({ statuses: results ?? [] });
});

status.post('/:id/view', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const inserted = await c.env.DB.prepare('INSERT OR IGNORE INTO status_views (id, status_id, viewer_id) VALUES (?, ?, ?)')
    .bind(newId(), id, userId)
    .run();
  if (inserted.meta.changes > 0) {
    await c.env.DB.prepare('UPDATE statuses SET view_count = view_count + 1 WHERE id = ?').bind(id).run();
  }
  return c.json({ success: true });
});

status.get('/:id/views', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    `SELECT sv.*, u.full_name, u.username, u.avatar_url FROM status_views sv
     JOIN users u ON u.id = sv.viewer_id WHERE sv.status_id = ? ORDER BY sv.viewed_at DESC`
  )
    .bind(id)
    .all();
  return c.json({ views: results ?? [] });
});

status.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM statuses WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ success: true });
});

export default status;
