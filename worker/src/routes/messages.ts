import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';
import { broadcastToRoom, roomIdFor } from '../lib/realtime';

const messages = new Hono<{ Bindings: Env; Variables: Variables }>();
messages.use('*', requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messageJson(row: any) {
  return {
    id: row.id,
    sender_id: row.sender_id,
    receiver_id: row.receiver_id,
    content: row.content,
    type: row.type,
    media_url: row.media_url ?? undefined,
    thumbnail_url: row.thumbnail_url ?? undefined,
    fileName: row.file_name ?? undefined,
    fileSize: row.file_size ?? undefined,
    duration: row.duration ?? undefined,
    client_message_id: row.client_message_id ?? undefined,
    reply_to: row.reply_to ?? undefined,
    is_read: !!row.is_read,
    is_edited: !!row.is_edited,
    edited_at: row.edited_at ?? undefined,
    is_deleted: !!row.is_deleted,
    deleted_for: row.deleted_for ? JSON.parse(row.deleted_for) : undefined,
    reactions: row.reactions ? JSON.parse(row.reactions) : undefined,
    created_at: row.created_at,
  };
}

// GET /messages/with/:userId — conversation history with another user
messages.get('/with/:otherId', async (c) => {
  const userId = c.get('userId');
  const otherId = c.req.param('otherId');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM messages
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
     ORDER BY created_at ASC LIMIT 200`
  )
    .bind(userId, otherId, otherId, userId)
    .all();
  return c.json({ messages: (results ?? []).map(messageJson) });
});

// GET /messages/chats — chat list: friends with a conversation + last message + unread count
messages.get('/chats', async (c) => {
  const userId = c.get('userId');
  const { results: friendRows } = await c.env.DB.prepare(
    `SELECT u.* FROM friendships f
     JOIN users u ON u.id = (CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END)
     WHERE f.user1_id = ? OR f.user2_id = ?`
  )
    .bind(userId, userId, userId)
    .all();

  const chats = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const u of (friendRows ?? []) as any[]) {
    const last = await c.env.DB.prepare(
      `SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(userId, u.id, u.id, userId)
      .first();
    const unread = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM messages WHERE sender_id = ? AND receiver_id = ? AND is_read = 0`
    )
      .bind(u.id, userId)
      .first<{ n: number }>();
    chats.push({
      user_id: u.id,
      status: 'accepted',
      profile: { id: u.id, full_name: u.full_name, username: u.username, avatar_url: u.avatar_url, email: u.email },
      lastMessage: last ? messageJson(last) : undefined,
      unreadCount: unread?.n ?? 0,
    });
  }
  // Most recent conversation first.
  chats.sort((a, b) => {
    const at = a.lastMessage?.created_at ?? '';
    const bt = b.lastMessage?.created_at ?? '';
    return bt.localeCompare(at);
  });
  return c.json({ chats });
});

messages.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const { receiver_id, content = '', type = 'text', client_message_id } = body;
  if (!receiver_id) return c.json({ error: 'receiver_id is required' }, 400);

  // Idempotent retry support via client_message_id.
  if (client_message_id) {
    const existing = await c.env.DB.prepare('SELECT * FROM messages WHERE sender_id = ? AND client_message_id = ?')
      .bind(userId, client_message_id)
      .first();
    if (existing) return c.json({ message: messageJson(existing) });
  }

  const id = newId();
  const created_at = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO messages (id, sender_id, receiver_id, content, type, media_url, thumbnail_url, file_name, file_size, duration, client_message_id, reply_to, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      userId,
      receiver_id,
      content,
      type,
      body.media_url ?? null,
      body.thumbnail_url ?? null,
      body.fileName ?? null,
      body.fileSize ?? null,
      body.duration ?? null,
      client_message_id ?? null,
      body.reply_to ?? null,
      created_at
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
  const msg = messageJson(row);

  // Fan out to both participants' realtime room so open chats update live.
  await broadcastToRoom(c.env, roomIdFor(userId, receiver_id), { type: 'message:new', message: msg });

  return c.json({ message: msg }, 201);
});

messages.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { content } = await c.req.json().catch(() => ({}));
  const row = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').bind(id, userId).first<{
    receiver_id: string;
  }>();
  if (!row) return c.json({ error: 'Message not found' }, 404);

  await c.env.DB.prepare(
    "UPDATE messages SET content = ?, is_edited = 1, edited_at = datetime('now') WHERE id = ?"
  )
    .bind(content, id)
    .run();
  const updated = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
  await broadcastToRoom(c.env, roomIdFor(userId, row.receiver_id), { type: 'message:edit', message: messageJson(updated) });
  return c.json({ message: messageJson(updated) });
});

messages.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').bind(id, userId).first<{
    receiver_id: string;
  }>();
  if (!row) return c.json({ error: 'Message not found' }, 404);

  await c.env.DB.prepare('UPDATE messages SET is_deleted = 1, content = ? WHERE id = ?').bind('', id).run();
  await broadcastToRoom(c.env, roomIdFor(userId, row.receiver_id), { type: 'message:delete', messageId: id });
  return c.json({ success: true });
});

messages.post('/:id/reaction', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { emoji } = await c.req.json().catch(() => ({}));
  const row = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<{
    reactions: string | null;
    sender_id: string;
    receiver_id: string;
  }>();
  if (!row) return c.json({ error: 'Message not found' }, 404);

  const reactions: Record<string, string[]> = row.reactions ? JSON.parse(row.reactions) : {};
  const list = reactions[emoji] ?? [];
  reactions[emoji] = list.includes(userId) ? list.filter((u) => u !== userId) : [...list, userId];
  if (reactions[emoji].length === 0) delete reactions[emoji];

  await c.env.DB.prepare('UPDATE messages SET reactions = ? WHERE id = ?').bind(JSON.stringify(reactions), id).run();
  const other = row.sender_id === userId ? row.receiver_id : row.sender_id;
  await broadcastToRoom(c.env, roomIdFor(userId, other), { type: 'message:reaction', messageId: id, reactions });
  return c.json({ reactions });
});

messages.post('/mark-read', async (c) => {
  const userId = c.get('userId');
  const { sender_id } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?')
    .bind(sender_id, userId)
    .run();
  return c.json({ success: true });
});

export default messages;
