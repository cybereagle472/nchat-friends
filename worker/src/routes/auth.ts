import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { hashPassword, verifyPassword } from '../lib/password';
import { signJWT, verifyJWT } from '../lib/jwt';
import { newId } from '../lib/id';
import { requireAuth } from '../middleware/auth';

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TTL_DAYS = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userPublic(row: any) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    username: row.username ?? undefined,
    avatar_url: row.avatar_url ?? undefined,
    bio: row.bio ?? undefined,
    is_admin: !!row.is_admin,
    created_at: row.created_at,
  };
}

// Refresh tokens rotate on every use (see /refresh below), and the access
// token they back is refreshed proactively every ~14 minutes while the app
// is open (see lib/apiClient.ts's scheduleProactiveRefresh) — so a single
// long-lived session can otherwise generate dozens of session rows a day,
// forever, with nothing ever deleting them. There's no Cron Trigger wired
// up for a scheduled sweep, so instead this piggybacks a cheap, bounded
// cleanup onto every token issuance (signup/login/refresh all call this):
// delete any session row that's actually expired. Combined with /refresh
// and /logout now deleting the row they're replacing/ending outright
// (instead of just flagging it revoked_at forever), the table naturally
// stays sized to roughly "one row per currently-active session" rather
// than accumulating every session anyone has ever had.
async function sweepExpiredSessions(env: Env): Promise<void> {
  try {
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  } catch {
    /* best-effort housekeeping — never let this block an actual auth call */
  }
}

async function issueTokens(env: Env, userId: string) {
  const sid = newId();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(sid, userId, expiresAt)
    .run();
  // Awaited (not fire-and-forget): Workers can tear down the execution
  // context as soon as the response is sent, which would silently cancel
  // a detached promise here.
  await sweepExpiredSessions(env);
  const access_token = await signJWT({ sub: userId }, env.JWT_SECRET, ACCESS_TTL_SECONDS);
  const refresh_token = await signJWT({ sub: userId, sid }, env.JWT_SECRET, REFRESH_TTL_DAYS * 86400);
  return { access_token, refresh_token, expires_in: ACCESS_TTL_SECONDS };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Real-time "is this email already registered" check used by the Sign Up
// form so a user finds out before filling out the whole form (and before
// hitting the 409 on actual submit). Public/no-auth — it only ever reveals
// whether an email is taken, which signup's own error response already
// discloses anyway.
auth.get('/check-email', async (c) => {
  const email = (c.req.query('email') || '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return c.json({ valid: false, exists: false });
  }
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  return c.json({ valid: true, exists: !!row });
});

auth.post('/signup', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  // full_name/username/avatar are collected later by the Profile Setup screen —
  // signup itself only needs an email + password, matching the existing UI.
  const full_name = (body.full_name || '').trim();

  if (!email || !password) {
    return c.json({ error: 'email and password are required' }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return c.json({ error: 'Please enter a valid email address' }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email is already registered' }, 409);

  const id = newId();
  const password_hash = await hashPassword(password);
  await c.env.DB.prepare('INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)')
    .bind(id, email, password_hash, full_name)
    .run();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO privacy_settings (user_id) VALUES (?)').bind(id),
    c.env.DB.prepare('INSERT INTO notification_settings (user_id) VALUES (?)').bind(id),
  ]);

  const tokens = await issueTokens(c.env, id);
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return c.json({ user: userPublic(row), ...tokens }, 201);
});

auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<any>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const tokens = await issueTokens(c.env, row.id);
  return c.json({ user: userPublic(row), ...tokens });
});

auth.post('/refresh', async (c) => {
  const { refresh_token } = await c.req.json().catch(() => ({ refresh_token: null }));
  if (!refresh_token) return c.json({ error: 'refresh_token is required' }, 400);

  const payload = await verifyJWT<{ sub: string; sid: string }>(refresh_token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired refresh token' }, 401);

  // Rotate: the used refresh token is single-use, so there's nothing worth
  // keeping its row around for — delete it outright rather than just
  // flagging it revoked_at forever, which otherwise means the sessions
  // table grows by one permanent row on every single refresh (happening
  // every ~14 minutes for as long as anyone keeps the app open). Folding
  // the old "look it up, then separately delete it" into one atomic
  // DELETE also closes a small race: if this same (single-use) refresh
  // token were ever replayed twice at nearly the same instant, checking
  // `changes` here guarantees at most one of the two calls can ever
  // succeed, instead of both reading "still valid" before either delete
  // lands and both going on to mint their own session.
  const result = await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .bind(payload.sid, payload.sub)
    .run();
  if (!result.meta.changes) return c.json({ error: 'Session has been revoked' }, 401);

  const tokens = await issueTokens(c.env, payload.sub);
  return c.json(tokens);
});

auth.post('/logout', async (c) => {
  const { refresh_token } = await c.req.json().catch(() => ({ refresh_token: null }));
  if (refresh_token) {
    const payload = await verifyJWT<{ sid: string }>(refresh_token, c.env.JWT_SECRET);
    if (payload?.sid) {
      // An explicit sign-out ends this session for good — delete its row
      // rather than leaving a revoked one behind forever.
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(payload.sid).run();
    }
  }
  return c.json({ success: true });
});

auth.get('/me', requireAuth, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('userId')).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ user: userPublic(row) });
});

export default auth;
