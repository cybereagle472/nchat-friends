import { supabase } from '../supabaseClient';
import { UserProfile } from '../types';

export const profileService = {
  // Get profile by ID
  async getProfile(userId: string): Promise<UserProfile | null> {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    return data as UserProfile | null;
  },

  // Get all profiles (for discover/find friends)
  async getAllProfiles(): Promise<UserProfile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .not('full_name', 'is', null)
      .not('username', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching all profiles:', error);
      return [];
    }

    return (data || []) as UserProfile[];
  },

  // Create new profile (uses upsert to handle existing profiles)
  async createProfile(profile: {
    id: string;
    email: string;
    full_name: string;
    username: string;
    avatar_url: string;
    bio?: string;
  }): Promise<{ success: boolean; profile?: UserProfile; error?: string }> {
    // Use upsert to create or update the profile
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        username: profile.username,
        avatar_url: profile.avatar_url,
        bio: profile.bio || 'Hey there! I am using NChat.'
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('Profile creation error:', error);
      if (error.code === '23505') {
        if (error.message?.includes('username')) {
          return { success: false, error: 'Username already taken' };
        }
        return { success: false, error: 'Profile already exists' };
      }
      return { success: false, error: error.message };
    }

    return { success: true, profile: data as UserProfile };
  },

  // Update profile
  async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  },

  // Check if username is available
  async isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    let query = supabase
      .from('profiles')
      .select('id')
      .eq('username', username.toLowerCase());

    if (excludeUserId) {
      query = query.neq('id', excludeUserId);
    }

    const { data } = await query.maybeSingle();
    return !data;
  },

  // Update last seen
  async updateLastSeen(userId: string): Promise<void> {
    await supabase
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', userId);
  }
};
