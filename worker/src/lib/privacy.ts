import type { Env } from '../types';

export type PrivacyOption = 'everyone' | 'contacts' | 'nobody';

export interface PrivacySettingsRow {
  user_id: string;
  last_seen_visibility: PrivacyOption;
  profile_photo_visibility: PrivacyOption;
  about_visibility: PrivacyOption;
  status_visibility: PrivacyOption;
  read_receipts: number;
  online_status_enabled: number;
}

const DEFAULTS: Omit<PrivacySettingsRow, 'user_id'> = {
  last_seen_visibility: 'everyone',
  profile_photo_visibility: 'everyone',
  about_visibility: 'everyone',
  status_visibility: 'contacts',
  read_receipts: 1,
  online_status_enabled: 1,
};

function withDefaults(userId: string, row?: Partial<PrivacySettingsRow> | null): PrivacySettingsRow {
  return { user_id: userId, ...DEFAULTS, ...(row ?? {}) };
}

/** Fetch one user's privacy settings, falling back to defaults if no row exists yet. */
export async function getPrivacySettings(env: Env, userId: string): Promise<PrivacySettingsRow> {
  const row = await env.DB.prepare('SELECT * FROM privacy_settings WHERE user_id = ?')
    .bind(userId)
    .first<PrivacySettingsRow>();
  return withDefaults(userId, row);
}

/** Batch-fetch privacy settings for many users in a single query. */
export async function getPrivacySettingsMap(env: Env, userIds: string[]): Promise<Map<string, PrivacySettingsRow>> {
  const map = new Map<string, PrivacySettingsRow>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return map;

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT * FROM privacy_settings WHERE user_id IN (${placeholders})`
  )
    .bind(...ids)
    .all<PrivacySettingsRow>();

  const found = new Set<string>();
  (results ?? []).forEach((r) => {
    map.set(r.user_id, withDefaults(r.user_id, r));
    found.add(r.user_id);
  });
  // Anyone without a row yet (e.g. created before privacy_settings existed) still gets defaults.
  ids.filter((id) => !found.has(id)).forEach((id) => map.set(id, withDefaults(id)));
  return map;
}

export async function upsertPrivacySettings(
  env: Env,
  userId: string,
  updates: Partial<Omit<PrivacySettingsRow, 'user_id'>>
): Promise<PrivacySettingsRow> {
  const current = await getPrivacySettings(env, userId);
  const next = { ...current, ...updates };
  await env.DB.prepare(
    `INSERT INTO privacy_settings
       (user_id, last_seen_visibility, profile_photo_visibility, about_visibility, status_visibility, read_receipts, online_status_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       last_seen_visibility = excluded.last_seen_visibility,
       profile_photo_visibility = excluded.profile_photo_visibility,
       about_visibility = excluded.about_visibility,
       status_visibility = excluded.status_visibility,
       read_receipts = excluded.read_receipts,
       online_status_enabled = excluded.online_status_enabled`
  )
    .bind(
      userId,
      next.last_seen_visibility,
      next.profile_photo_visibility,
      next.about_visibility,
      next.status_visibility,
      next.read_receipts,
      next.online_status_enabled
    )
    .run();
  return next;
}

/** Are these two users friends? (self always counts as "yes" so self-checks never get redacted.) */
export async function areFriends(env: Env, a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const row = await env.DB.prepare(
    'SELECT 1 FROM friendships WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)'
  )
    .bind(a, b, b, a)
    .first();
  return !!row;
}

/** Batch version of areFriends: who, among `otherIds`, is a friend of `userId`? */
export async function getFriendIdSet(env: Env, userId: string, otherIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(otherIds)].filter((id) => id && id !== userId);
  const set = new Set<string>();
  if (ids.length === 0) return set;
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT user1_id, user2_id FROM friendships
     WHERE (user1_id = ? AND user2_id IN (${placeholders}))
        OR (user2_id = ? AND user1_id IN (${placeholders}))`
  )
    .bind(userId, ...ids, userId, ...ids)
    .all<{ user1_id: string; user2_id: string }>();
  (results ?? []).forEach((r) => set.add(r.user1_id === userId ? r.user2_id : r.user1_id));
  return set;
}

export function isVisible(setting: PrivacyOption, isSelf: boolean, isFriend: boolean): boolean {
  if (isSelf) return true;
  if (setting === 'everyone') return true;
  if (setting === 'nobody') return false;
  return isFriend;
}

/**
 * Redact the presence/photo/about fields of a profile-shaped object
 * according to the *target's* (the profile owner's) privacy settings, from
 * `viewerId`'s point of view. Safe to call with viewerId === the profile's
 * own id (never redacts your own profile from yourself).
 */
export function applyPrivacy<
  T extends { id: string; avatar_url?: unknown; bio?: unknown; is_online?: unknown; last_seen?: unknown }
>(profile: T, viewerId: string, settings: PrivacySettingsRow, isFriend: boolean): T {
  const isSelf = profile.id === viewerId;
  const result = { ...profile };

  if (!isVisible(settings.profile_photo_visibility, isSelf, isFriend)) {
    result.avatar_url = undefined;
  }
  if (!isVisible(settings.about_visibility, isSelf, isFriend)) {
    result.bio = undefined;
  }
  if (!isVisible(settings.last_seen_visibility, isSelf, isFriend)) {
    result.last_seen = undefined;
  }
  if (!isSelf && !settings.online_status_enabled) {
    result.is_online = false;
  }
  return result;
}

/** Batch-apply applyPrivacy() to a list of other users' profiles for one viewer. */
export async function applyPrivacyToList<
  T extends { id: string; avatar_url?: unknown; bio?: unknown; is_online?: unknown; last_seen?: unknown }
>(env: Env, viewerId: string, profiles: T[]): Promise<T[]> {
  const ids = profiles.map((p) => p.id).filter((id) => id !== viewerId);
  if (ids.length === 0) return profiles;
  const [settingsMap, friendSet] = await Promise.all([
    getPrivacySettingsMap(env, ids),
    getFriendIdSet(env, viewerId, ids),
  ]);
  return profiles.map((p) => {
    if (p.id === viewerId) return p;
    const settings = settingsMap.get(p.id) ?? withDefaults(p.id);
    return applyPrivacy(p, viewerId, settings, friendSet.has(p.id));
  });
}
