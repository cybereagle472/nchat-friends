/**
 * Privacy Settings Service
 * Manages user privacy preferences for last seen, profile photo, about, etc.
 */

import { supabase } from '../supabaseClient';

export type PrivacyOption = 'everyone' | 'contacts' | 'nobody';

export interface PrivacySettings {
  user_id: string;
  last_seen: PrivacyOption;
  profile_photo: PrivacyOption;
  about: PrivacyOption;
  read_receipts: boolean;
  online_status: boolean;
  created_at?: string;
  updated_at?: string;
}

const DEFAULT_PRIVACY_SETTINGS: Omit<PrivacySettings, 'user_id'> = {
  last_seen: 'everyone',
  profile_photo: 'everyone',
  about: 'everyone',
  read_receipts: true,
  online_status: true
};

class PrivacyService {
  /**
   * Get privacy settings for a user
   */
  async getSettings(userId: string): Promise<{
    success: boolean;
    data?: PrivacySettings;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('privacy_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      // Return default settings if none exist
      if (!data) {
        return {
          success: true,
          data: {
            user_id: userId,
            ...DEFAULT_PRIVACY_SETTINGS
          }
        };
      }

      return { success: true, data };
    } catch (error: any) {
      console.error('Failed to get privacy settings:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update privacy settings
   */
  async updateSettings(
    userId: string,
    settings: Partial<Omit<PrivacySettings, 'user_id'>>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('privacy_settings')
        .upsert({
          user_id: userId,
          ...settings,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;
      return { success: true };
    } catch (error: any) {
      console.error('Failed to update privacy settings:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if a user can see another user's last seen
   */
  async canSeeLastSeen(viewerId: string, targetUserId: string): Promise<boolean> {
    try {
      // Get target user's privacy settings
      const result = await this.getSettings(targetUserId);
      if (!result.success || !result.data) return false;

      const { last_seen } = result.data;

      if (last_seen === 'everyone') return true;
      if (last_seen === 'nobody') return false;

      // 'contacts' - check if they are friends
      if (last_seen === 'contacts') {
        const { data } = await supabase
          .from('friendships')
          .select('id')
          .or(`and(user1_id.eq.${viewerId},user2_id.eq.${targetUserId}),and(user1_id.eq.${targetUserId},user2_id.eq.${viewerId})`)
          .single();

        return !!data;
      }

      return false;
    } catch (error) {
      console.error('Error checking last seen visibility:', error);
      return false;
    }
  }

  /**
   * Check if a user can see another user's profile photo
   */
  async canSeeProfilePhoto(viewerId: string, targetUserId: string): Promise<boolean> {
    try {
      const result = await this.getSettings(targetUserId);
      if (!result.success || !result.data) return true; // Default to visible

      const { profile_photo } = result.data;

      if (profile_photo === 'everyone') return true;
      if (profile_photo === 'nobody') return false;

      if (profile_photo === 'contacts') {
        const { data } = await supabase
          .from('friendships')
          .select('id')
          .or(`and(user1_id.eq.${viewerId},user2_id.eq.${targetUserId}),and(user1_id.eq.${targetUserId},user2_id.eq.${viewerId})`)
          .single();

        return !!data;
      }

      return true;
    } catch (error) {
      console.error('Error checking profile photo visibility:', error);
      return true;
    }
  }

  /**
   * Get last seen status with privacy check
   */
  async getLastSeenForViewer(
    viewerId: string,
    targetUserId: string
  ): Promise<{ visible: boolean; lastSeen?: string; isOnline?: boolean }> {
    try {
      const canSee = await this.canSeeLastSeen(viewerId, targetUserId);

      if (!canSee) {
        return { visible: false };
      }

      // Get the target user's last seen
      const { data, error } = await supabase
        .from('profiles')
        .select('last_seen, is_online')
        .eq('id', targetUserId)
        .single();

      if (error || !data) {
        return { visible: false };
      }

      return {
        visible: true,
        lastSeen: data.last_seen,
        isOnline: data.is_online
      };
    } catch (error) {
      console.error('Error getting last seen for viewer:', error);
      return { visible: false };
    }
  }

  /**
   * Update user's last seen timestamp
   */
  async updateLastSeen(userId: string): Promise<void> {
    try {
      await supabase
        .from('profiles')
        .update({
          last_seen: new Date().toISOString(),
          is_online: true
        })
        .eq('id', userId);
    } catch (error) {
      console.error('Failed to update last seen:', error);
    }
  }

  /**
   * Set user as offline
   */
  async setOffline(userId: string): Promise<void> {
    try {
      await supabase
        .from('profiles')
        .update({
          last_seen: new Date().toISOString(),
          is_online: false
        })
        .eq('id', userId);
    } catch (error) {
      console.error('Failed to set offline:', error);
    }
  }
}

export const privacyService = new PrivacyService();
export default privacyService;
