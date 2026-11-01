import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';
import { broadcastToUser } from '../lib/realtime';

const groups = new Hono<{ Bindings: Env; Variables: Variables }>();
groups.use('*', requireAuth);

async function getMembership(env: Env, groupId: string, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return env.DB.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, userId)
    .first<any>();
}

async function memberIdsOf(env: Env, groupId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT user_id FROM group_members WHERE group_id = ?').bind(groupId).all<{ user_id: string }>();
  return (results ?? []).map((r) => r.user_id);
}

/** Fan a group-scoped event out to every member's personal realtime room
 * (the same `user:<id>` room every other feature already uses) — a group
 * doesn't have its own room clients subscribe to, since every client holds
 * a single shared WebSocket for their own room only. */
async function broadcastToGroup(env: Env, groupId: string, payload: unknown, memberIds?: string[]): Promise<void> {
  const ids = memberIds ?? (await memberIdsOf(env, groupId));
  await Promise.all(ids.map((uid) => broadcastToUser(env, uid, payload)));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function groupWithMembers(env: Env, groupId: string): Promise<any | null> {
  const group = await env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first<any>();
  if (!group) return null;
  const { results: memberRows } = await env.DB.prepare(
    `SELECT gm.*, u.full_name, u.username, u.avatar_url, u.email FROM group_members gm
     JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?`
  )
    .bind(groupId)
    .all<any>();
  return {
    ...group,
    members: (memberRows ?? []).map((m: any) => ({
      group_id: m.group_id,
      user_id: m.user_id,
      role: m.role,
      is_muted: !!m.is_muted,
      joined_at: m.joined_at,
      profile: { id: m.user_id, full_name: m.full_name, username: m.username, avatar_url: m.avatar_url, email: m.email },
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function groupMessageJson(row: any) {
  return {
    id: row.id,
    group_id: row.group_id,
    sender_id: row.sender_id,
    content: row.content,
    type: row.type,
    media_url: row.media_url ?? undefined,
    thumbnail_url: row.thumbnail_url ?? undefined,
    client_message_id: row.client_message_id ?? undefined,
    reply_to: row.reply_to ?? undefined,
    is_edited: !!row.is_edited,
    edited_at: row.edited_at ?? undefined,
    is_deleted: !!row.is_deleted,
    deleted_for: row.deleted_for ? JSON.parse(row.deleted_for) : undefined,
    reactions: row.reactions ? JSON.parse(row.reactions) : undefined,
    created_at: row.created_at,
  };
}

groups.post('/', async (c) => {
  const userId = c.get('userId');
  const { name, description, avatar_url, memberIds = [] } = await c.req.json().catch(() => ({}));
  if (!name || !String(name).trim()) return c.json({ error: 'name is required' }, 400);

  const groupId = newId();
  const created_at = nowIso();
  await c.env.DB.prepare('INSERT INTO groups (id, name, description, avatar_url, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(groupId, String(name).trim(), description?.trim() || null, avatar_url || null, userId, created_at)
    .run();

  const allMembers: string[] = Array.from(new Set([userId, ...(memberIds as string[])]));
  await c.env.DB.batch(
    allMembers.map((uid) =>
      c.env.DB.prepare('INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, ?)').bind(
        newId(),
        groupId,
        uid,
        uid === userId ? 'admin' : 'member'
      )
    )
  );

  const group = await groupWithMembers(c.env, groupId);
  // Let every invited member's device pick up the new group immediately
  // (their Groups tab) without waiting for a manual refresh.
  await broadcastToGroup(c.env, groupId, { type: 'group:created', group }, allMembers);
  return c.json({ group }, 201);
});

groups.get('/', async (c) => {
  const userId = c.get('userId');
  const { results: groupRows } = await c.env.DB.prepare(
    `SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = ? ORDER BY g.created_at DESC`
  )
    .bind(userId)
    .all();

  const groupsWithMembers = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const g of (groupRows ?? []) as any[]) {
    const full = await groupWithMembers(c.env, g.id);
    const lastMessage = await c.env.DB.prepare(
      'SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(g.id)
      .first();

    groupsWithMembers.push({
      ...full,
      lastMessage: lastMessage ? groupMessageJson(lastMessage) : undefined,
    });
  }
  return c.json({ groups: groupsWithMembers });
});

groups.get('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const membership = await getMembership(c.env, groupId, userId);
  if (!membership) return c.json({ error: 'Not a member of this group' }, 403);

  const group = await groupWithMembers(c.env, groupId);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  return c.json({ group });
});

groups.get('/:id/members', async (c) => {
  const groupId = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    `SELECT gm.*, u.full_name, u.username, u.avatar_url, u.email FROM group_members gm
     JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?`
  )
    .bind(groupId)
    .all();
  return c.json({ members: results ?? [] });
});

groups.post('/:id/members', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const membership = await getMembership(c.env, groupId, userId);
  if (!membership) return c.json({ error: 'Not a member of this group' }, 403);
  if (membership.role !== 'admin') return c.json({ error: 'Only admins can add members' }, 403);

  const { memberIds = [] } = await c.req.json().catch(() => ({}));
  const newIds = (memberIds as string[]).filter((uid) => uid);
  if (newIds.length === 0) return c.json({ success: true });

  await c.env.DB.batch(
    newIds.map((uid) =>
      c.env.DB.prepare('INSERT OR IGNORE INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, ?)').bind(
        newId(),
        groupId,
        uid,
        'member'
      )
    )
  );

  const group = await groupWithMembers(c.env, groupId);
  await broadcastToGroup(c.env, groupId, { type: 'group-member:joined', group_id: groupId, members: group?.members ?? [] });
  // Make sure the newly-added members themselves hear about it even if
  // broadcastToGroup's membership lookup (post-insert) already includes
  // them — kept explicit so this still works if that lookup ever changes.
  await broadcastToGroup(c.env, groupId, { type: 'group:created', group }, newIds);
  return c.json({ success: true, members: group?.members ?? [] });
});

groups.delete('/:id/members/:userId', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const targetId = c.req.param('userId');

  const membership = await getMembership(c.env, groupId, userId);
  if (!membership) return c.json({ error: 'Not a member of this group' }, 403);
  if (membership.role !== 'admin' && userId !== targetId) {
    return c.json({ error: 'Only admins can remove other members' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, targetId).run();
  await broadcastToGroup(c.env, groupId, { type: 'group-member:left', group_id: groupId, user_id: targetId });
  await broadcastToUser(c.env, targetId, { type: 'group-member:left', group_id: groupId, user_id: targetId });
  return c.json({ success: true });
});

groups.post('/:id/leave', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');

  const { results: members } = await c.env.DB.prepare('SELECT user_id, role FROM group_members WHERE group_id = ?')
    .bind(groupId)
    .all<{ user_id: string; role: string }>();
  const allMembers = members ?? [];
  const admins = allMembers.filter((m) => m.role === 'admin');
  const isOnlyAdmin = admins.length === 1 && admins[0].user_id === userId;

  if (isOnlyAdmin && allMembers.length > 1) {
    return c.json({ error: 'Make someone else an admin before you leave' }, 400);
  }

  await c.env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, userId).run();

  if (allMembers.length <= 1) {
    // That was the last member — nothing left to keep the group around for.
    await c.env.DB.prepare('DELETE FROM group_messages WHERE group_id = ?').bind(groupId).run();
    await c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(groupId).run();
  } else {
    await broadcastToGroup(c.env, groupId, { type: 'group-member:left', group_id: groupId, user_id: userId });
  }
  await broadcastToUser(c.env, userId, { type: 'group-member:left', group_id: groupId, user_id: userId });
  return c.json({ success: true });
});

groups.patch('/:id/members/:userId', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const targetId = c.req.param('userId');
  const { role } = await c.req.json().catch(() => ({}));
  if (role !== 'admin' && role !== 'member') return c.json({ error: 'role must be admin or member' }, 400);
  if (userId === targetId) return c.json({ error: 'You cannot change your own role' }, 400);

  const membership = await getMembership(c.env, groupId, userId);
  if (membership?.role !== 'admin') return c.json({ error: 'Only admins can change member roles' }, 403);

  await c.env.DB.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').bind(role, groupId, targetId).run();
  const group = await groupWithMembers(c.env, groupId);
  await broadcastToGroup(c.env, groupId, { type: 'group-member:updated', group_id: groupId, members: group?.members ?? [] });
  return c.json({ success: true });
});

groups.patch('/:id/mute', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const { muted } = await c.req.json().catch(() => ({}));

  const membership = await getMembership(c.env, groupId, userId);
  if (!membership) return c.json({ error: 'Not a member of this group' }, 403);

  await c.env.DB.prepare('UPDATE group_members SET is_muted = ? WHERE group_id = ? AND user_id = ?')
    .bind(muted ? 1 : 0, groupId, userId)
    .run();
  return c.json({ success: true });
});

groups.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const membership = await getMembership(c.env, groupId, userId);
  if (membership?.role !== 'admin') return c.json({ error: 'Only admins can update group info' }, 403);

  const { name, description, avatar_url } = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first<any>();
  if (!current) return c.json({ error: 'Group not found' }, 404);

  const nextName = name !== undefined ? String(name).trim() : current.name;
  const nextDescription = description !== undefined ? (String(description).trim() || null) : current.description;
  const nextAvatar = avatar_url !== undefined ? avatar_url : current.avatar_url;

  await c.env.DB.prepare(
    "UPDATE groups SET name = ?, description = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(nextName, nextDescription, nextAvatar, groupId)
    .run();

  const group = await groupWithMembers(c.env, groupId);
  await broadcastToGroup(c.env, groupId, { type: 'group:updated', group });
  return c.json({ success: true, group });
});

groups.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const membership = await getMembership(c.env, groupId, userId);
  if (membership?.role !== 'admin') return c.json({ error: 'Only admins can delete the group' }, 403);

  const memberIds = await memberIdsOf(c.env, groupId);
  // Explicit cascade: D1/SQLite only enforces ON DELETE CASCADE for
  // connections that ran `PRAGMA foreign_keys = ON`, which isn't
  // guaranteed to carry over to every request's connection, so these are
  // deleted directly rather than relying on it.
  await c.env.DB.prepare('DELETE FROM group_messages WHERE group_id = ?').bind(groupId).run();
  await c.env.DB.prepare('DELETE FROM group_members WHERE group_id = ?').bind(groupId).run();
  await c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(groupId).run();

  await broadcastToGroup(c.env, groupId, { type: 'group:deleted', group_id: groupId }, memberIds);
  return c.json({ success: true });
});

groups.get('/:id/messages', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const membership = await getMembership(c.env, groupId, userId);
  if (!membership) return c.json({ error: 'Not a member of this group' }, 403);

  const before = c.req.query('before');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);

  const { results } = before
    ? await c.env.DB.prepare(
        'SELECT * FROM group_messages WHERE group_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?'
      )
        .bind(groupId, before, limit)
        .all()
    : await c.env.DB.prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ?')
        .bind(groupId, limit)
        .all();

  const messages = (results ?? []).map(groupMessageJson).reverse();
  return c.json({ messages });
});

groups.post('/:id/messages', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const membership = await getMembership(c.env, groupId, userId);
  if (!membership) return c.json({ error: 'Not a member of this group' }, 403);

  const body = await c.req.json().catch(() => ({}));

  // Idempotent retry support via client_message_id, same pattern as 1:1
  // messages — a retried send (e.g. after a flaky connection) must not
  // create a second row.
  if (body.client_message_id) {
    const existing = await c.env.DB.prepare('SELECT * FROM group_messages WHERE group_id = ? AND sender_id = ? AND client_message_id = ?')
      .bind(groupId, userId, body.client_message_id)
      .first();
    if (existing) return c.json({ message: groupMessageJson(existing) });
  }

  const id = newId();
  const created_at = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO group_messages (id, group_id, sender_id, content, type, media_url, thumbnail_url, client_message_id, reply_to, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      groupId,
      userId,
      body.content ?? '',
      body.type ?? 'text',
      body.media_url ?? null,
      body.thumbnail_url ?? null,
      body.client_message_id ?? null,
      body.reply_to ?? null,
      created_at
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM group_messages WHERE id = ?').bind(id).first();
  const msg = groupMessageJson(row);
  await broadcastToGroup(c.env, groupId, { type: 'group-message:new', message: msg });
  return c.json({ message: msg }, 201);
});

// These three are deliberately NOT nested under /:id/messages/:messageId —
// the frontend only ever has a bare messageId handy at the call sites that
// need them (message action sheets), not the group it belongs to, so the
// group_id is looked up from the message row itself instead of the URL.
groups.post('/messages/:messageId/delete-for-me', async (c) => {
  const userId = c.get('userId');
  const messageId = c.req.param('messageId');
  const row = await c.env.DB.prepare('SELECT deleted_for FROM group_messages WHERE id = ?').bind(messageId).first<{ deleted_for: string | null }>();
  if (!row) return c.json({ error: 'Message not found' }, 404);

  const deletedFor: string[] = row.deleted_for ? JSON.parse(row.deleted_for) : [];
  if (!deletedFor.includes(userId)) deletedFor.push(userId);

  await c.env.DB.prepare('UPDATE group_messages SET deleted_for = ? WHERE id = ?').bind(JSON.stringify(deletedFor), messageId).run();
  return c.json({ success: true });
});

groups.post('/messages/:messageId/delete-for-everyone', async (c) => {
  const userId = c.get('userId');
  const messageId = c.req.param('messageId');

  const row = await c.env.DB.prepare('SELECT group_id, sender_id, created_at FROM group_messages WHERE id = ?').bind(messageId).first<{
    group_id: string;
    sender_id: string;
    created_at: string;
  }>();
  if (!row) return c.json({ error: 'Message not found' }, 404);
  if (row.sender_id !== userId) return c.json({ error: 'You can only delete your own messages' }, 403);

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  if (new Date(row.created_at).getTime() < oneHourAgo) {
    return c.json({ error: 'Cannot delete messages older than 1 hour' }, 400);
  }

  await c.env.DB.prepare("UPDATE group_messages SET is_deleted = 1, content = 'This message was deleted' WHERE id = ?")
    .bind(messageId)
    .run();

  await broadcastToGroup(c.env, row.group_id, { type: 'group-message:delete', group_id: row.group_id, message_id: messageId });
  return c.json({ success: true });
});

groups.post('/messages/:messageId/reaction', async (c) => {
  const userId = c.get('userId');
  const messageId = c.req.param('messageId');
  const { emoji } = await c.req.json().catch(() => ({}));
  if (!emoji) return c.json({ error: 'emoji is required' }, 400);

  const row = await c.env.DB.prepare('SELECT group_id, reactions FROM group_messages WHERE id = ?').bind(messageId).first<{
    group_id: string;
    reactions: string | null;
  }>();
  if (!row) return c.json({ error: 'Message not found' }, 404);

  const reactions: Record<string, string[]> = row.reactions ? JSON.parse(row.reactions) : {};
  const list = reactions[emoji] ?? [];
  reactions[emoji] = list.includes(userId) ? list.filter((u) => u !== userId) : [...list, userId];
  if (reactions[emoji].length === 0) delete reactions[emoji];

  await c.env.DB.prepare('UPDATE group_messages SET reactions = ? WHERE id = ?').bind(JSON.stringify(reactions), messageId).run();
  await broadcastToGroup(c.env, row.group_id, { type: 'group-message:reaction', group_id: row.group_id, message_id: messageId, reactions });
  return c.json({ reactions });
});

export default groups;
