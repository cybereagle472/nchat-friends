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

  // Get all profiles (for discover/find friends)
  async getAllProfiles(): Promise<UserProfile[]> {
    try {
      const { profiles } = await apiFetch<{ profiles: UserProfile[] }>('/users/');
      return profiles.filter((p) => p.full_name && p.username);
    } catch (err) {
      console.error('Error fetching all profiles:', err);
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
