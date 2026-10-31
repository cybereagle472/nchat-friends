import type { Env } from '../types';

/** A user with no heartbeat in this long is considered offline. */
export const ONLINE_THRESHOLD_MS = 120_000;

export function computeIsOnline(lastActiveAt?: number | null): boolean {
  return !!lastActiveAt && Date.now() - lastActiveAt < ONLINE_THRESHOLD_MS;
}

/** Attach is_online / last_seen to a profile-shaped object. */
export function withPresence<T extends Record<string, unknown>>(
  profile: T,
  lastActiveAt?: number | null
): T & { is_online: boolean; last_seen?: string } {
  return {
    ...profile,
    is_online: computeIsOnline(lastActiveAt),
    last_seen: lastActiveAt ? new Date(lastActiveAt).toISOString() : undefined,
  };
}

export async function getPresence(env: Env, userId: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT last_active_at FROM presence WHERE user_id = ?')
    .bind(userId)
    .first<{ last_active_at: number }>();
  return row?.last_active_at ?? null;
}

/** Batch-fetch last-active timestamps for many users in a single query. */
export async function getPresenceMap(env: Env, userIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return map;

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT user_id, last_active_at FROM presence WHERE user_id IN (${placeholders})`
  )
    .bind(...ids)
    .all<{ user_id: string; last_active_at: number }>();

  (results ?? []).forEach((r) => map.set(r.user_id, r.last_active_at));
  return map;
}
