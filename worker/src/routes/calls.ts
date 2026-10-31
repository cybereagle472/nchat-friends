import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';
import { broadcastToRoom, userRoomId } from '../lib/realtime';

const calls = new Hono<{ Bindings: Env; Variables: Variables }>();
calls.use('*', requireAuth);

calls.post('/', async (c) => {
  const userId = c.get('userId');
  const { receiver_id, call_type, offer_sdp } = await c.req.json().catch(() => ({}));
  if (!receiver_id || !call_type) return c.json({ error: 'receiver_id and call_type are required' }, 400);

  const id = newId();
  const created_at = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO calls (id, caller_id, receiver_id, call_type, status, offer_sdp, created_at)
     VALUES (?, ?, ?, ?, 'ringing', ?, ?)`
  )
    .bind(id, userId, receiver_id, call_type, offer_sdp ? JSON.stringify(offer_sdp) : null, created_at)
    .run();

  // Ring the callee over their personal realtime room.
  await broadcastToRoom(c.env, userRoomId(receiver_id), {
    type: 'call:incoming',
    call: { id, caller_id: userId, receiver_id, call_type, status: 'ringing', created_at, offer_sdp },
  });

  return c.json({ call: { id, caller_id: userId, receiver_id, call_type, status: 'ringing', created_at } }, 201);
});

calls.post('/:id/signal', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const call = await c.env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first<{
    caller_id: string;
    receiver_id: string;
  }>();
  if (!call) return c.json({ error: 'Call not found' }, 404);

  const otherId = call.caller_id === userId ? call.receiver_id : call.caller_id;
  await broadcastToRoom(c.env, userRoomId(otherId), { type: 'call:signal', callId: id, from: userId, ...body });
  return c.json({ success: true });
});

calls.post('/:id/answer', async (c) => {
  const id = c.req.param('id');
  const { answer_sdp } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare("UPDATE calls SET status = 'answered', answer_sdp = ? WHERE id = ?")
    .bind(JSON.stringify(answer_sdp ?? null), id)
    .run();
  const call = await c.env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first<{ caller_id: string }>();
  if (call) await broadcastToRoom(c.env, userRoomId(call.caller_id), { type: 'call:answered', callId: id, answer_sdp });
  return c.json({ success: true });
});

calls.post('/:id/end', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { status = 'ended', duration } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare("UPDATE calls SET status = ?, duration = ?, ended_at = datetime('now') WHERE id = ?")
    .bind(status, duration ?? null, id)
    .run();
  const call = await c.env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first<{
    caller_id: string;
    receiver_id: string;
  }>();
  if (call) {
    const otherId = call.caller_id === userId ? call.receiver_id : call.caller_id;
    await broadcastToRoom(c.env, userRoomId(otherId), { type: 'call:ended', callId: id, status });
  }
  return c.json({ success: true });
});

calls.get('/history', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT cl.*, u.full_name, u.avatar_url FROM calls cl
     JOIN users u ON u.id = (CASE WHEN cl.caller_id = ? THEN cl.receiver_id ELSE cl.caller_id END)
     WHERE cl.caller_id = ? OR cl.receiver_id = ?
     ORDER BY cl.created_at DESC LIMIT 100`
  )
    .bind(userId, userId, userId)
    .all();
  return c.json({ history: results ?? [] });
});

export default calls;
