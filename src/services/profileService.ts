import { api, convex } from '../lib/convexClient';
import type { UserProfile } from '../types';

function mapProfile(u: {
  _id?: string;
  id?: string;
  full_name?: string;
  username?: string;
  email?: string;
  avatar_url?: string;
  bio?: string;
  is_online?: boolean;
} | null): UserProfile | null {
  if (!u) return null;
  const userId = (u._id ?? u.id) as string;
  return {
    id: userId,
    full_name: u.full_name || 'User',
    username: u.username,
    email: u.email ?? '',
    avatar_url: u.avatar_url,
    bio: u.bio,
    is_online: u.is_online ?? false,
  };
}

export const profileService = {
  async getProfile(userId: string): Promise<UserProfile | null> {
    try {
      const profile = await convex.query(api.users.getUserById, {
        userId: userId as never,
      });
      return mapProfile(profile as never);
    } catch {
      return null;
    }
  },

  async getAllProfiles(): Promise<UserProfile[]> {
    try {
      const profiles = await convex.query(api.users.getAllProfiles, {});
      return (profiles as never as Array<Record<string, unknown>>).map((p) => mapProfile(p as never)!);
    } catch {
      return [];
    }
  },

  async createProfile(profile: {
    id: string;
    email: string;
    full_name: string;
    username: string;
    avatar_url: string;
    bio?: string;
  }): Promise<{ success: boolean; profile?: UserProfile; error?: string }> {
    try {
      // Save to server
      await convex.mutation(api.users.updateProfile, {
        full_name: profile.full_name,
        username: profile.username.toLowerCase(),
        avatar_url: profile.avatar_url,
        bio: profile.bio || 'Hey there! I am using NChat.',
      });

      // Re-fetch from server to get the authoritative saved data
      // (avoids returning stale blob URLs or incomplete data)
      const freshProfile = await convex.query(api.users.getUserById, {
        userId: profile.id as never,
      });

      if (freshProfile) {
        return { success: true, profile: mapProfile(freshProfile as never)! };
      }

      // Fallback: if re-fetch fails, return input (still better than error)
      return { success: true, profile: profile as UserProfile };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Username already taken')) {
        return { success: false, error: 'Username already taken' };
      }
      return { success: false, error: msg };
    }
  },

  async updateProfile(
    userId: string,
    updates: Partial<UserProfile>
  ): Promise<{ success: boolean; profile?: UserProfile; error?: string }> {
    try {
      const patch: Record<string, string> = {};
      if (updates.full_name !== undefined) patch.full_name = updates.full_name;
      if (updates.username !== undefined) patch.username = updates.username.toLowerCase();
      if (updates.avatar_url !== undefined) patch.avatar_url = updates.avatar_url;
      if (updates.bio !== undefined) patch.bio = updates.bio;
      await convex.mutation(api.users.updateProfile, patch);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    try {
      return await convex.query(api.users.isUsernameAvailable, {
        username: username.toLowerCase(),
        excludeUserId: excludeUserId as never,
      });
    } catch {
      return false;
    }
  },

  async updateLastSeen(_userId: string): Promise<void> {
    try {
      await convex.mutation(api.typing.upsertPresence, {});
    } catch {
      /* ignore */
    }
  },
};
