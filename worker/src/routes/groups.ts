import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';
import { broadcastToRoom, groupRoomId } from '../lib/realtime';

const groups = new Hono<{ Bindings: Env; Variables: Variables }>();
groups.use('*', requireAuth);

async function requireMember(env: Env, groupId: string, userId: string) {
  return env.DB.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, userId).first();
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
    reactions: row.reactions ? JSON.parse(row.reactions) : undefined,
    created_at: row.created_at,
  };
}

groups.post('/', async (c) => {
  const userId = c.get('userId');
  const { name, description, memberIds = [] } = await c.req.json().catch(() => ({}));
  if (!name) return c.json({ error: 'name is required' }, 400);

  const groupId = newId();
  const created_at = nowIso();
  await c.env.DB.prepare('INSERT INTO groups (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(groupId, name, description ?? null, userId, created_at)
    .run();

  const allMembers: string[] = Array.from(new Set([userId, ...memberIds]));
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

  return c.json({ group: { id: groupId, name, description, created_by: userId, created_at } }, 201);
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
    const { results: memberRows } = await c.env.DB.prepare(
      `SELECT gm.*, u.full_name, u.username, u.avatar_url, u.email FROM group_members gm
       JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?`
    )
      .bind(g.id)
      .all();
    const lastMessage = await c.env.DB.prepare(
      'SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(g.id)
      .first();

    groupsWithMembers.push({
      ...g,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      members: (memberRows ?? []).map((m: any) => ({
        group_id: m.group_id,
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        profile: { id: m.user_id, full_name: m.full_name, username: m.username, avatar_url: m.avatar_url, email: m.email },
      })),
      lastMessage: lastMessage ? groupMessageJson(lastMessage) : undefined,
    });
  }
  return c.json({ groups: groupsWithMembers });
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
  const membership = await requireMember(c.env, groupId, userId);
  if (!membership) return c.json({ error: 'Not a member of this group' }, 403);

  const { memberIds = [] } = await c.req.json().catch(() => ({}));
  await c.env.DB.batch(
    (memberIds as string[]).map((uid) =>
      c.env.DB.prepare('INSERT OR IGNORE INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, ?)').bind(
        newId(),
        groupId,
        uid,
        'member'
      )
    )
  );
  return c.json({ success: true });
});

groups.delete('/:id/members/:userId', async (c) => {
  const groupId = c.req.param('id');
  const targetId = c.req.param('userId');
  await c.env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, targetId).run();
  return c.json({ success: true });
});

groups.post('/:id/leave', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, userId).run();
  return c.json({ success: true });
});

groups.patch('/:id', async (c) => {
  const groupId = c.req.param('id');
  const { name } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare("UPDATE groups SET name = ?, updated_at = datetime('now') WHERE id = ?").bind(name, groupId).run();
  return c.json({ success: true });
});

groups.get('/:id/messages', async (c) => {
  const groupId = c.req.param('id');
  const { results } = await c.env.DB.prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at ASC LIMIT 200')
    .bind(groupId)
    .all();
  return c.json({ messages: (results ?? []).map(groupMessageJson) });
});

groups.post('/:id/messages', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const membership = await requireMember(c.env, groupId, userId);
  if (!membership) return c.json({ error: 'Not a member of this group' }, 403);

  const body = await c.req.json().catch(() => ({}));
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
  await broadcastToRoom(c.env, groupRoomId(groupId), { type: 'group-message:new', message: msg });
  return c.json({ message: msg }, 201);
});

export default groups;
