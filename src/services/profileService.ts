import { api, convex } from '../lib/convexClient';
import type { UserProfile } from '../types';

function mapProfile(u: {
  id: string;
  full_name?: string;
  username?: string;
  email?: string;
  avatar_url?: string;
  bio?: string;
} | null): UserProfile | null {
  if (!u) return null;
  return {
    id: u.id,
    full_name: u.full_name || 'User',
    username: u.username,
    email: u.email ?? '',
    avatar_url: u.avatar_url,
    bio: u.bio,
    is_online: false,
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
      await convex.mutation(api.users.updateProfile, {
        full_name: profile.full_name,
        username: profile.username.toLowerCase(),
        avatar_url: profile.avatar_url,
        bio: profile.bio || 'Hey there! I am using NChat.',
      });
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
  ): Promise<{ success: boolean; error?: string }> {
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
