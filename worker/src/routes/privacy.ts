import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { getPrivacySettings, upsertPrivacySettings, type PrivacyOption } from '../lib/privacy';

const privacy = new Hono<{ Bindings: Env; Variables: Variables }>();
privacy.use('*', requireAuth);

const OPTIONS: PrivacyOption[] = ['everyone', 'contacts', 'nobody'];
const isOption = (v: unknown): v is PrivacyOption => typeof v === 'string' && OPTIONS.includes(v as PrivacyOption);

privacy.get('/', async (c) => {
  const settings = await getPrivacySettings(c.env, c.get('userId'));
  return c.json({ settings });
});

privacy.patch('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (isOption(body.last_seen_visibility)) updates.last_seen_visibility = body.last_seen_visibility;
  if (isOption(body.profile_photo_visibility)) updates.profile_photo_visibility = body.profile_photo_visibility;
  if (isOption(body.about_visibility)) updates.about_visibility = body.about_visibility;
  if (isOption(body.status_visibility)) updates.status_visibility = body.status_visibility;
  if (typeof body.read_receipts === 'boolean') updates.read_receipts = body.read_receipts ? 1 : 0;
  if (typeof body.online_status_enabled === 'boolean') updates.online_status_enabled = body.online_status_enabled ? 1 : 0;

  if (Object.keys(updates).length === 0) return c.json({ error: 'No valid fields to update' }, 400);

  const settings = await upsertPrivacySettings(c.env, userId, updates);
  return c.json({ settings });
});

export default privacy;
