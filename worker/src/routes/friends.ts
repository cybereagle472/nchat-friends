import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { newId } from '../lib/id';
import { broadcastToUser } from '../lib/realtime';
import { getPresence, getPresenceMap, withPresence } from '../lib/presence';
import { applyPrivacy, applyPrivacyToList, getPrivacySettings } from '../lib/privacy';

const friends = new Hono<{ Bindings: Env; Variables: Variables }>();
friends.use('*', requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function profilePublic(row: any, lastActiveAt?: number | null) {
  return withPresence(
    {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      username: row.username ?? undefined,
      avatar_url: row.avatar_url ?? undefined,
      bio: row.bio ?? undefined,
    },
    lastActiveAt
  );
}


friends.post('/request', async (c) => {
  const userId = c.get('userId');
  const { receiver_id } = await c.req.json().catch(() => ({}));
  if (!receiver_id || receiver_id === userId) return c.json({ error: 'Invalid receiver_id' }, 400);

  const blocked = await c.env.DB.prepare(
    'SELECT 1 FROM blocked_users WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)'
  )
    .bind(userId, receiver_id, receiver_id, userId)
    .first();
  if (blocked) return c.json({ error: 'Cannot send a request to this user' }, 403);

  const existing = await c.env.DB.prepare(
    `SELECT * FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`
  )
    .bind(userId, receiver_id, receiver_id, userId)
    .first<{ id: string; status: string }>();
  if (existing) {
    if (existing.status === 'pending') return c.json({ error: 'Request already pending' }, 409);
    if (existing.status === 'accepted') return c.json({ error: 'Already friends' }, 409);
  }

  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO friend_requests (id, sender_id, receiver_id, status) VALUES (?, ?, ?, 'pending')
     ON CONFLICT(sender_id, receiver_id) DO UPDATE SET status = 'pending', updated_at = datetime('now')`
  )
    .bind(id, userId, receiver_id)
    .run();

  const sender = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  const senderLastActiveAt = await getPresence(c.env, userId);
  // You aren't friends yet at request time, so the sender's privacy
  // settings (e.g. "last seen: contacts only") correctly apply here.
  const senderSettings = await getPrivacySettings(c.env, userId);
  await broadcastToUser(c.env, receiver_id, {
    type: 'friend:request',
    request: {
      id,
      sender_id: userId,
      receiver_id,
      status: 'pending',
      sender_profile: sender
        ? applyPrivacy(profilePublic(sender, senderLastActiveAt), receiver_id, senderSettings, false)
        : undefined,
    },
  });

  return c.json({ success: true, id }, 201);
});

friends.post('/:id/respond', async (c) => {
  const userId = c.get('userId');
  const requestId = c.req.param('id');
  const { accept } = await c.req.json().catch(() => ({ accept: false }));

  const req = await c.env.DB.prepare('SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ?')
    .bind(requestId, userId)
    .first<{ id: string; sender_id: string; receiver_id: string; status: string }>();
  if (!req) return c.json({ error: 'Request not found' }, 404);
  if (req.status !== 'pending') return c.json({ error: 'Request already handled' }, 409);

  if (accept) {
    const friendshipId = newId();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").bind(
        requestId
      ),
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO friendships (id, user1_id, user2_id) VALUES (?, ?, ?)'
      ).bind(friendshipId, req.sender_id, req.receiver_id),
    ]);

    const accepter = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    const accepterLastActiveAt = await getPresence(c.env, userId);
    const accepterSettings = await getPrivacySettings(c.env, userId);
    await broadcastToUser(c.env, req.sender_id, {
      type: 'friend:accepted',
      // They just became friends (inserted above), so the "contacts"
      // visibility tier already applies.
      friend: accepter
        ? applyPrivacy(profilePublic(accepter, accepterLastActiveAt), req.sender_id, accepterSettings, true)
        : { id: userId },
    });
  } else {
    await c.env.DB.prepare("UPDATE friend_requests SET status = 'rejected', updated_at = datetime('now') WHERE id = ?")
      .bind(requestId)
      .run();
    await broadcastToUser(c.env, req.sender_id, { type: 'friend:declined', userId });
  }
  return c.json({ success: true });
});

friends.delete('/request/:id', async (c) => {
  const userId = c.get('userId');
  const requestId = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM friend_requests WHERE id = ? AND sender_id = ?').bind(requestId, userId).run();
  return c.json({ success: true });
});

friends.get('/requests', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT fr.*, u.id as u_id, u.full_name, u.username, u.avatar_url, u.email, u.bio
     FROM friend_requests fr JOIN users u ON u.id = fr.sender_id
     WHERE fr.receiver_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`
  )
    .bind(userId)
    .all();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (results ?? []) as any[];
  const presenceMap = await getPresenceMap(c.env, rows.map((r) => r.u_id));
  const senderProfiles = await applyPrivacyToList(
    c.env,
    userId,
    rows.map((r) =>
      profilePublic(
        { id: r.u_id, full_name: r.full_name, username: r.username, avatar_url: r.avatar_url, email: r.email, bio: r.bio },
        presenceMap.get(r.u_id)
      )
    )
  );
  const requests = rows.map((r, i) => ({
    id: r.id,
    sender_id: r.sender_id,
    receiver_id: r.receiver_id,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    sender_profile: senderProfiles[i],
  }));
  return c.json({ requests });
});

friends.get('/sent', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT id, receiver_id, created_at, updated_at FROM friend_requests WHERE sender_id = ? AND status = 'pending'`
  )
    .bind(userId)
    .all<{ id: string; receiver_id: string; created_at: string; updated_at: string }>();
  const rows = results ?? [];
  return c.json({
    receiverIds: rows.map((r) => r.receiver_id),
    requests: rows.map((r) => ({ id: r.id, receiver_id: r.receiver_id, created_at: r.created_at, updated_at: r.updated_at })),
  });
});

friends.get('/', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT u.* FROM friendships f
     JOIN users u ON u.id = (CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END)
     WHERE f.user1_id = ? OR f.user2_id = ?
     ORDER BY u.full_name`
  )
    .bind(userId, userId, userId)
    .all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (results ?? []) as any[];
  const presenceMap = await getPresenceMap(c.env, rows.map((r) => r.id));
  const profiles = await applyPrivacyToList(c.env, userId, rows.map((r) => profilePublic(r, presenceMap.get(r.id))));
  const friendsList = rows.map((r, i) => ({ id: r.id, profile: profiles[i] }));
  return c.json({ friends: friendsList });
});

friends.delete('/:friendId', async (c) => {
  const userId = c.get('userId');
  const friendId = c.req.param('friendId');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM friendships WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)').bind(
      userId,
      friendId,
      friendId,
      userId
    ),
    c.env.DB.prepare('DELETE FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)').bind(
      userId,
      friendId,
      friendId,
      userId
    ),
  ]);
  // Let the other side know live too, so their Friends/Chats tabs drop this
  // person immediately instead of waiting for their next manual refresh.
  await broadcastToUser(c.env, friendId, { type: 'friend:removed', userId });
  return c.json({ success: true });
});

friends.post('/block', async (c) => {
  const userId = c.get('userId');
  const { user_id } = await c.req.json().catch(() => ({}));
  if (!user_id) return c.json({ error: 'user_id is required' }, 400);
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO blocked_users (id, user_id, blocked_user_id) VALUES (?, ?, ?)').bind(
      id,
      userId,
      user_id
    ),
    c.env.DB.prepare('DELETE FROM friendships WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)').bind(
      userId,
      user_id,
      user_id,
      userId
    ),
  ]);
  return c.json({ success: true });
});

friends.post('/unblock', async (c) => {
  const userId = c.get('userId');
  const { user_id } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare('DELETE FROM blocked_users WHERE user_id = ? AND blocked_user_id = ?').bind(userId, user_id).run();
  return c.json({ success: true });
});

friends.get('/blocked', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT u.* FROM blocked_users b JOIN users u ON u.id = b.blocked_user_id WHERE b.user_id = ?`
  )
    .bind(userId)
    .all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blockedProfiles = await applyPrivacyToList(c.env, userId, ((results ?? []) as any[]).map((r) => profilePublic(r)));
  return c.json({ blocked: blockedProfiles });
});

export default friends;
