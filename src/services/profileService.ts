import { apiFetch, ApiError } from '../lib/apiClient';
import { UserProfile } from '../types';

interface ProfileResponse {
  profile: UserProfile;
}

export const profileService = {
  // Get profile by ID
  async getProfile(userId: string): Promise<UserProfile | null> {
    try {
      const { profile } = await apiFetch<ProfileResponse>(`/users/${userId}`);
      return profile;
    } catch {
      return null;
    }
  },

  // Used by authService.resolveProfileState for "is *my own* profile
  // complete?" — hits /users/me, which derives the id to look up purely
  // from the verified access token (c.get('userId') on the server), not
  // from any client-supplied id, so there's no way for a momentarily-stale
  // cached id (e.g. mid access-token refresh) to turn into a spurious 404
  // for your own, perfectly real profile. Distinguishes "no profile" (404)
  // from "the request failed" (expired/invalid session, network blip,
  // server hiccup, ...) — session bootstrapping relies on that distinction,
  // since silently swallowing a transient error would wrongly look like a
  // brand-new user and send a fully set-up, returning user back through
  // onboarding.
  async getMyProfileOrThrow(): Promise<UserProfile | null> {
    try {
      const { profile } = await apiFetch<ProfileResponse>('/users/me');
      return profile;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },

  // Get all profiles (for discover/find friends)
  async getAllProfiles(): Promise<UserProfile[]> {
    try {
      const { profiles } = await apiFetch<{ profiles: UserProfile[] }>('/users');
      return profiles.filter((p) => p.full_name && p.username);
    } catch (err) {
      console.error('Error fetching all profiles:', err);
      return [];
    }
  },

  // Real-time username/name search across *every* user on the server —
  // not just whatever's already been loaded into `getAllProfiles()`'s
  // capped, most-recently-joined snapshot. Callers are expected to debounce
  // keystrokes themselves (see Discover.tsx's `useDebouncedValue`); this
  // method itself just does one round-trip per call.
  async searchUsers(query: string): Promise<UserProfile[]> {
    const q = query.trim();
    if (!q) return [];
    try {
      const { profiles } = await apiFetch<{ profiles: UserProfile[] }>(
        `/users/search?q=${encodeURIComponent(q)}`
      );
      return profiles.filter((p) => p.full_name);
    } catch (err) {
      console.error('Error searching users:', err);
      return [];
    }
  },

  // Create/complete a profile (Profile Setup screen) — PATCHes the user created at signup.
  async createProfile(profile: {
    id: string;
    email: string;
    full_name: string;
    username: string;
    avatar_url: string;
    bio?: string;
  }): Promise<{ success: boolean; profile?: UserProfile; error?: string }> {
    try {
      const { profile: updated } = await apiFetch<ProfileResponse>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: profile.full_name,
          username: profile.username,
          avatar_url: profile.avatar_url,
          bio: profile.bio || 'Hey there! I am using NChat.',
        }),
      });
      return { success: true, profile: updated };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Profile creation failed';
      return { success: false, error: message };
    }
  },

  // Update profile
  async updateProfile(_userId: string, updates: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> {
    try {
      await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify(updates) });
      return { success: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Update failed';
      return { success: false, error: message };
    }
  },

  // Check if username is available
  async isUsernameAvailable(username: string): Promise<boolean> {
    try {
      const { available } = await apiFetch<{ available: boolean }>(
        `/users/username-available?username=${encodeURIComponent(username.toLowerCase())}`
      );
      return available;
    } catch {
      return false;
    }
  },

  // Update last seen (presence heartbeat)
  async updateLastSeen(_userId: string): Promise<void> {
    try {
      await apiFetch('/users/presence', { method: 'POST' });
    } catch {
      /* best-effort */
    }
  },
};
