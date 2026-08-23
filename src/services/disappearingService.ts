/**
 * Disappearing Messages Service
 * Handles auto-delete settings and cleanup of expired messages
 */

import { supabase } from '../supabaseClient';

export type DisappearingDuration =
  | 'off'
  | '24h'
  | '7d'
  | '90d';

export interface DisappearingSettings {
  chatId: string;
  chatType: 'user' | 'group';
  duration: DisappearingDuration;
  enabled_at?: string;
  enabled_by?: string;
}

// Convert duration to milliseconds
const durationToMs = (duration: DisappearingDuration): number => {
  switch (duration) {
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '90d': return 90 * 24 * 60 * 60 * 1000;
    default: return 0;
  }
};

// Get human-readable duration label
export const getDurationLabel = (duration: DisappearingDuration): string => {
  switch (duration) {
    case '24h': return '24 hours';
    case '7d': return '7 days';
    case '90d': return '90 days';
    default: return 'Off';
  }
};

class DisappearingService {
  /**
   * Get disappearing message settings for a chat
   */
  async getSettings(userId: string, chatId: string, chatType: 'user' | 'group'): Promise<{
    success: boolean;
    data?: DisappearingSettings;
    error?: string;
  }> {
    try {
      // Create a consistent chat room ID for 1-1 chats
      const roomId = chatType === 'user'
        ? [userId, chatId].sort().join('_')
        : chatId;

      const { data, error } = await supabase
        .from('disappearing_settings')
        .select('*')
        .eq('chat_id', roomId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error;
      }

      return {
        success: true,
        data: data || {
          chatId: roomId,
          chatType,
          duration: 'off' as DisappearingDuration
        }
      };
    } catch (error: any) {
      console.error('Failed to get disappearing settings:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update disappearing message settings for a chat
   */
  async setSettings(
    userId: string,
    chatId: string,
    chatType: 'user' | 'group',
    duration: DisappearingDuration
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Create a consistent chat room ID for 1-1 chats
      const roomId = chatType === 'user'
        ? [userId, chatId].sort().join('_')
        : chatId;

      const { error } = await supabase
        .from('disappearing_settings')
        .upsert({
          chat_id: roomId,
          chat_type: chatType,
          duration,
          enabled_at: duration !== 'off' ? new Date().toISOString() : null,
          enabled_by: duration !== 'off' ? userId : null,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'chat_id'
        });

      if (error) throw error;

      return { success: true };
    } catch (error: any) {
      console.error('Failed to set disappearing settings:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check and delete expired messages for a chat
   * This should be called periodically or when opening a chat
   */
  async cleanupExpiredMessages(
    userId: string,
    chatId: string,
    chatType: 'user' | 'group'
  ): Promise<{ success: boolean; deletedCount: number; error?: string }> {
    try {
      // Get settings first
      const settingsResult = await this.getSettings(userId, chatId, chatType);
      if (!settingsResult.success || !settingsResult.data) {
        return { success: true, deletedCount: 0 };
      }

      const { duration, enabled_at } = settingsResult.data;
      if (duration === 'off' || !enabled_at) {
        return { success: true, deletedCount: 0 };
      }

      const expirationMs = durationToMs(duration);
      const now = Date.now();

      // Only delete messages created after the setting was enabled
      // that are older than the duration
      const cutoffTime = new Date(now - expirationMs).toISOString();

      if (chatType === 'user') {
        // For 1-1 chats
        const { data: deleted, error } = await supabase
          .from('messages')
          .delete()
          .or(`and(sender_id.eq.${userId},receiver_id.eq.${chatId}),and(sender_id.eq.${chatId},receiver_id.eq.${userId})`)
          .lt('created_at', cutoffTime)
          .gte('created_at', enabled_at)
          .select('id');

        if (error) throw error;
        return { success: true, deletedCount: deleted?.length || 0 };
      } else {
        // For group chats
        const { data: deleted, error } = await supabase
          .from('group_messages')
          .delete()
          .eq('group_id', chatId)
          .lt('created_at', cutoffTime)
          .gte('created_at', enabled_at)
          .select('id');

        if (error) throw error;
        return { success: true, deletedCount: deleted?.length || 0 };
      }
    } catch (error: any) {
      console.error('Failed to cleanup expired messages:', error);
      return { success: false, deletedCount: 0, error: error.message };
    }
  }

  /**
   * Mark a message for disappearing (set expiration time)
   * Called when sending a message in a chat with disappearing enabled
   */
  async markMessageForDisappearing(
    messageId: string,
    tableName: 'messages' | 'group_messages',
    duration: DisappearingDuration
  ): Promise<{ success: boolean; error?: string }> {
    if (duration === 'off') {
      return { success: true };
    }

    try {
      const expiresAt = new Date(Date.now() + durationToMs(duration)).toISOString();

      const { error } = await supabase
        .from(tableName)
        .update({ expires_at: expiresAt })
        .eq('id', messageId);

      if (error) throw error;
      return { success: true };
    } catch (error: any) {
      console.error('Failed to mark message for disappearing:', error);
      return { success: false, error: error.message };
    }
  }
}

export const disappearingService = new DisappearingService();
export default disappearingService;
