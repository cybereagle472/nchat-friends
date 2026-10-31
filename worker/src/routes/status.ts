import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';
import { broadcastToUser } from '../lib/realtime';

const status = new Hono<{ Bindings: Env; Variables: Variables }>();
status.use('*', requireAuth);

/** All current friend ids for a user (order-independent friendships table). */
async function friendIdsOf(env: Env, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END as friend_id
     FROM friendships WHERE user1_id = ? OR user2_id = ?`
  )
    .bind(userId, userId, userId)
    .all<{ friend_id: string }>();
  return (results ?? []).map((r) => r.friend_id);
}

status.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const id = newId();
  const created_at = nowIso();
  const expires_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO statuses (id, user_id, content_type, content_url, text_content, background_color, font_style, thumbnail_url, duration, caption, privacy, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      userId,
      body.content_type ?? 'text',
      body.content_url ?? null,
      body.text_content ?? null,
      body.background_color ?? null,
      body.font_style ?? null,
      body.thumbnail_url ?? null,
      body.duration ?? null,
      body.caption ?? null,
      body.privacy ?? 'contacts',
      created_at,
      expires_at
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM statuses WHERE id = ?').bind(id).first();

  // Let every friend's open app know a new status just went up — this is
  // what makes the "recent updates" list (and the ring around an avatar)
  // appear live instead of only after the next manual refresh.
  const poster = await c.env.DB.prepare('SELECT full_name, username, avatar_url FROM users WHERE id = ?')
    .bind(userId)
    .first<{ full_name: string; username: string | null; avatar_url: string | null }>();

  const friendIds = await friendIdsOf(c.env, userId);
  await Promise.all(
    friendIds.map((friendId) =>
      broadcastToUser(c.env, friendId, {
        type: 'status:new',
        status: { ...row, full_name: poster?.full_name, username: poster?.username, avatar_url: poster?.avatar_url }
      })
    )
  );

  return c.json({ status: row }, 201);
});

status.get('/mine', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.content_type, s.content_url, s.text_content, s.background_color,
            s.font_style, s.thumbnail_url, s.duration, s.caption, s.privacy, s.created_at, s.expires_at,
            (SELECT COUNT(*) FROM status_views sv WHERE sv.status_id = s.id AND sv.viewer_id != s.user_id) as view_count
     FROM statuses s
     WHERE s.user_id = ? AND s.expires_at > datetime('now')
     ORDER BY s.created_at ASC`
  )
    .bind(userId)
    .all();
  return c.json({ statuses: results ?? [] });
});

// Statuses from friends, grouped by user. Includes whether the current
// viewer has already seen each one, so the client doesn't need a second
// round trip just to render the unviewed/viewed ring around an avatar.
// Ordered oldest-first so a contact's multiple updates play back in the
// order they actually happened (WhatsApp-style) — the client re-sorts
// which *contact* appears first by most-recent activity separately.
status.get('/feed', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, u.full_name, u.username, u.avatar_url,
       EXISTS(SELECT 1 FROM status_views sv WHERE sv.status_id = s.id AND sv.viewer_id = ?) as viewed_by_me
     FROM statuses s
     JOIN users u ON u.id = s.user_id
     JOIN friendships f ON (f.user1_id = ? AND f.user2_id = s.user_id) OR (f.user2_id = ? AND f.user1_id = s.user_id)
     WHERE s.expires_at > datetime('now')
       AND s.user_id NOT IN (SELECT muted_user_id FROM muted_statuses WHERE user_id = ?)
     ORDER BY s.created_at ASC`
  )
    .bind(userId, userId, userId, userId)
    .all();
  return c.json({ statuses: results ?? [] });
});

status.post('/:id/view', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const statusRow = await c.env.DB.prepare('SELECT user_id FROM statuses WHERE id = ?')
    .bind(id)
    .first<{ user_id: string }>();
  if (!statusRow) return c.json({ error: 'Status not found' }, 404);

  // Viewing your own status is not a "view" — don't record it, don't count
  // it, and don't notify yourself.
  if (statusRow.user_id === userId) {
    return c.json({ success: true });
  }

  const inserted = await c.env.DB.prepare('INSERT OR IGNORE INTO status_views (id, status_id, viewer_id) VALUES (?, ?, ?)')
    .bind(newId(), id, userId)
    .run();

  if (inserted.meta.changes > 0) {
    await c.env.DB.prepare('UPDATE statuses SET view_count = view_count + 1 WHERE id = ?').bind(id).run();

    // Tell the status owner so their viewer list / view count updates live
    // while they're looking at it.
    const viewer = await c.env.DB.prepare('SELECT full_name, username, avatar_url FROM users WHERE id = ?')
      .bind(userId)
      .first<{ full_name: string; username: string | null; avatar_url: string | null }>();
    await broadcastToUser(c.env, statusRow.user_id, {
      type: 'status:view',
      status_id: id,
      viewer_id: userId,
      viewer_profile: viewer ? { id: userId, ...viewer } : undefined
    });
  }

  return c.json({ success: true });
});

status.get('/:id/views', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    `SELECT sv.*, u.full_name, u.username, u.avatar_url FROM status_views sv
     JOIN users u ON u.id = sv.viewer_id
     JOIN statuses s ON s.id = sv.status_id
     WHERE sv.status_id = ? AND sv.viewer_id != s.user_id
     ORDER BY sv.viewed_at DESC`
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

// Mute/unmute a contact's status updates (hides them from /feed).
status.post('/mute', async (c) => {
  const userId = c.get('userId');
  const { muted_user_id } = await c.req.json().catch(() => ({}));
  if (!muted_user_id) return c.json({ error: 'muted_user_id is required' }, 400);
  await c.env.DB.prepare('INSERT OR IGNORE INTO muted_statuses (user_id, muted_user_id) VALUES (?, ?)')
    .bind(userId, muted_user_id)
    .run();
  return c.json({ success: true });
});

status.delete('/mute/:mutedUserId', async (c) => {
  const userId = c.get('userId');
  const mutedUserId = c.req.param('mutedUserId');
  await c.env.DB.prepare('DELETE FROM muted_statuses WHERE user_id = ? AND muted_user_id = ?')
    .bind(userId, mutedUserId)
    .run();
  return c.json({ success: true });
});

status.get('/muted', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare('SELECT muted_user_id FROM muted_statuses WHERE user_id = ?')
    .bind(userId)
    .all<{ muted_user_id: string }>();
  return c.json({ muted: (results ?? []).map((r) => r.muted_user_id) });
});

export default status;
