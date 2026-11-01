import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';
import { broadcastToRoom, userRoomId } from '../lib/realtime';
import { applyPrivacy, getPrivacySettings, areFriends } from '../lib/privacy';

const calls = new Hono<{ Bindings: Env; Variables: Variables }>();
calls.use('*', requireAuth);

interface CallRow {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: string;
  status: string;
  duration: number | null;
  created_at: string;
  ended_at: string | null;
}

async function getCallOr404(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first<CallRow>();
}

/** Only the two people on the call may act on it. */
function isParticipant(call: Pick<CallRow, 'caller_id' | 'receiver_id'>, userId: string): boolean {
  return call.caller_id === userId || call.receiver_id === userId;
}

calls.post('/', async (c) => {
  const userId = c.get('userId');
  const { receiver_id, call_type, offer_sdp } = await c.req.json().catch(() => ({}));
  if (!receiver_id || !call_type) return c.json({ error: 'receiver_id and call_type are required' }, 400);
  if (call_type !== 'audio' && call_type !== 'video') return c.json({ error: 'call_type must be audio or video' }, 400);
  if (receiver_id === userId) return c.json({ error: 'Cannot call yourself' }, 400);

  const blocked = await c.env.DB.prepare(
    'SELECT 1 FROM blocked_users WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)'
  )
    .bind(userId, receiver_id, receiver_id, userId)
    .first();
  if (blocked) return c.json({ error: 'Cannot call this user' }, 403);

  const id = newId();
  const created_at = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO calls (id, caller_id, receiver_id, call_type, status, offer_sdp, created_at)
     VALUES (?, ?, ?, ?, 'ringing', ?, ?)`
  )
    .bind(id, userId, receiver_id, call_type, offer_sdp ? JSON.stringify(offer_sdp) : null, created_at)
    .run();

  // The caller's privacy settings govern what the callee's incoming-call
  // screen shows for them (same "contacts"/"nobody" rules as everywhere
  // else), not just a bare caller_id.
  const [caller, callerSettings, isFriend] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first(),
    getPrivacySettings(c.env, userId),
    areFriends(c.env, userId, receiver_id),
  ]);
  const callerProfile = caller
    ? applyPrivacy(
        {
          id: userId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          full_name: (caller as any).full_name,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          avatar_url: (caller as any).avatar_url ?? undefined,
        },
        receiver_id,
        callerSettings,
        isFriend
      )
    : undefined;

  // Ring the callee over their personal realtime room.
  await broadcastToRoom(c.env, userRoomId(receiver_id), {
    type: 'call:incoming',
    call: { id, caller_id: userId, receiver_id, call_type, status: 'ringing', created_at, offer_sdp, caller_profile: callerProfile },
  });

  return c.json({ call: { id, caller_id: userId, receiver_id, call_type, status: 'ringing', created_at } }, 201);
});

// Generic signaling passthrough (ICE candidates, renegotiation, etc.) — the
// Worker doesn't need to understand the payload shape, just forward it to
// whichever of the two participants didn't send it.
calls.post('/:id/signal', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const call = await getCallOr404(c.env, id);
  if (!call) return c.json({ error: 'Call not found' }, 404);
  if (!isParticipant(call, userId)) return c.json({ error: 'Not authorized' }, 403);

  const otherId = call.caller_id === userId ? call.receiver_id : call.caller_id;
  await broadcastToRoom(c.env, userRoomId(otherId), { type: 'call:signal', callId: id, from: userId, ...body });
  return c.json({ success: true });
});

calls.post('/:id/answer', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { answer_sdp } = await c.req.json().catch(() => ({}));
  const call = await getCallOr404(c.env, id);
  if (!call) return c.json({ error: 'Call not found' }, 404);
  if (call.receiver_id !== userId) return c.json({ error: 'Only the callee can answer' }, 403);
  if (call.status !== 'ringing') return c.json({ error: 'Call is no longer ringing' }, 409);

  await c.env.DB.prepare("UPDATE calls SET status = 'answered', answer_sdp = ? WHERE id = ?")
    .bind(JSON.stringify(answer_sdp ?? null), id)
    .run();
  await broadcastToRoom(c.env, userRoomId(call.caller_id), { type: 'call:answered', callId: id, answer_sdp });
  return c.json({ success: true });
});

calls.post('/:id/end', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { status = 'ended', duration } = await c.req.json().catch(() => ({}));
  const call = await getCallOr404(c.env, id);
  if (!call) return c.json({ error: 'Call not found' }, 404);
  if (!isParticipant(call, userId)) return c.json({ error: 'Not authorized' }, 403);
  // Don't let a stale/duplicate "end" request overwrite an already-finished call's outcome.
  if (call.ended_at) return c.json({ success: true });

  await c.env.DB.prepare("UPDATE calls SET status = ?, duration = ?, ended_at = datetime('now') WHERE id = ?")
    .bind(status, duration ?? null, id)
    .run();

  const otherId = call.caller_id === userId ? call.receiver_id : call.caller_id;
  await broadcastToRoom(c.env, userRoomId(otherId), { type: 'call:ended', callId: id, status });
  return c.json({ success: true });
});

calls.get('/history', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200);
  const { results } = await c.env.DB.prepare(
    `SELECT cl.*, u.id as other_id, u.full_name, u.avatar_url FROM calls cl
     JOIN users u ON u.id = (CASE WHEN cl.caller_id = ? THEN cl.receiver_id ELSE cl.caller_id END)
     WHERE cl.caller_id = ? OR cl.receiver_id = ?
     ORDER BY cl.created_at DESC LIMIT ?`
  )
    .bind(userId, userId, userId, limit)
    .all();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (results ?? []) as any[];
  const otherIds = [...new Set(rows.map((r) => r.other_id))];
  const [settingsEntries, friendEntries] = await Promise.all([
    Promise.all(otherIds.map(async (id) => [id, await getPrivacySettings(c.env, id)] as const)),
    Promise.all(otherIds.map(async (id) => [id, await areFriends(c.env, userId, id)] as const)),
  ]);
  const settingsMap = new Map(settingsEntries);
  const friendMap = new Map(friendEntries);

  const history = rows.map((r) => {
    const settings = settingsMap.get(r.other_id);
    const otherProfile = settings
      ? applyPrivacy({ id: r.other_id, full_name: r.full_name, avatar_url: r.avatar_url ?? undefined }, userId, settings, !!friendMap.get(r.other_id))
      : { id: r.other_id, full_name: r.full_name, avatar_url: r.avatar_url ?? undefined };
    const { other_id, full_name, avatar_url, ...rest } = r;
    void other_id;
    void full_name;
    void avatar_url;
    return { ...rest, other_profile: otherProfile };
  });

  return c.json({ history });
});

export default calls;
