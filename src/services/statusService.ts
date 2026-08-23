/**
 * Status Service - WhatsApp-style Stories/Status
 *
 * Features:
 * - Create text, image, video statuses
 * - 24-hour auto-expiry
 * - View tracking with real-time updates
 * - Privacy controls (everyone, contacts, custom)
 * - Reply to status
 * - Mute status from specific users
 */

import { supabase } from '../supabaseClient';
import {
  Status,
  StatusView,
  UserStatuses,
  StatusPrivacy,
  UserProfile
} from '../types';
import { mediaService } from './mediaService';
import { generateVideoThumbnail, getVideoDuration } from '../utils/mediaUtils';

// Constants
const STATUS_EXPIRY_HOURS = 24;
const MAX_TEXT_LENGTH = 700;
const MAX_CAPTION_LENGTH = 200;

// Background colors for text statuses
export const STATUS_BACKGROUNDS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #20bf6b 0%, #0fb9b1 100%)',
  'linear-gradient(135deg, #eb3349 0%, #f45c43 100%)',
  'linear-gradient(135deg, #000428 0%, #004e92 100%)',
];

// Font styles for text statuses
export const STATUS_FONTS = [
  'default',      // System font
  'serif',        // Times-like
  'mono',         // Monospace
  'handwriting',  // Cursive
  'bold',         // Bold sans
];

export const statusService = {
  /**
   * Create a text status
   */
  async createTextStatus(
    userId: string,
    text: string,
    backgroundColor: string = STATUS_BACKGROUNDS[0],
    fontStyle: string = 'default',
    privacy: StatusPrivacy = 'contacts'
  ): Promise<Status | null> {
    console.log('[StatusService] createTextStatus called', { userId, textLength: text.length, backgroundColor, fontStyle, privacy });

    if (!text.trim() || text.length > MAX_TEXT_LENGTH) {
      console.error('[StatusService] Invalid text status content');
      return null;
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + STATUS_EXPIRY_HOURS);

    const insertData = {
      user_id: userId,
      content_type: 'text',
      text_content: text.trim(),
      background_color: backgroundColor,
      font_style: fontStyle,
      privacy,
      expires_at: expiresAt.toISOString(),
      view_count: 0
    };

    console.log('[StatusService] Inserting status into database...', insertData);

    try {
      const { data, error } = await supabase
        .from('statuses')
        .insert(insertData)
        .select()
        .single();

      console.log('[StatusService] Insert result - data:', data, 'error:', error);

      if (error) {
        console.error('[StatusService] Error creating text status:', error.message, error.details, error.hint, error.code);
        return null;
      }

      console.log('[StatusService] Status created successfully:', data);
      return data;
    } catch (err) {
      console.error('[StatusService] Exception during insert:', err);
      return null;
    }
  },

  /**
   * Create an image status
   */
  async createImageStatus(
    userId: string,
    imageFile: File,
    caption?: string,
    privacy: StatusPrivacy = 'contacts'
  ): Promise<Status | null> {
    try {
      // Upload image using mediaService
      const result = await mediaService.uploadMedia(imageFile, userId);
      if (!result.success || !result.url) {
        console.error('Failed to upload status image:', result.error);
        return null;
      }

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + STATUS_EXPIRY_HOURS);

      const { data, error } = await supabase
        .from('statuses')
        .insert({
          user_id: userId,
          content_type: 'image',
          content_url: result.url,
          caption: caption?.trim().slice(0, MAX_CAPTION_LENGTH),
          privacy,
          expires_at: expiresAt.toISOString(),
          view_count: 0
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating image status:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error creating image status:', error);
      return null;
    }
  },

  /**
   * Create a video status
   */
  async createVideoStatus(
    userId: string,
    videoFile: File,
    caption?: string,
    privacy: StatusPrivacy = 'contacts'
  ): Promise<Status | null> {
    try {
      // Upload video using mediaService
      const result = await mediaService.uploadMedia(videoFile, userId);
      if (!result.success || !result.url) {
        console.error('Failed to upload status video:', result.error);
        return null;
      }

      // Generate thumbnail
      let thumbnailUrl: string | undefined;
      try {
        const thumbnailBlob = await generateVideoThumbnail(videoFile);
        if (thumbnailBlob) {
          const thumbnailFile = new File([thumbnailBlob], 'thumbnail.jpg', { type: 'image/jpeg' });
          const thumbnailResult = await mediaService.uploadMedia(thumbnailFile, userId);
          if (thumbnailResult.success) {
            thumbnailUrl = thumbnailResult.url;
          }
        }
      } catch (e) {
        console.warn('Could not generate video thumbnail:', e);
      }

      // Get video duration
      let duration = 0;
      try {
        duration = await getVideoDuration(videoFile);
      } catch (e) {
        console.warn('Could not get video duration:', e);
      }

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + STATUS_EXPIRY_HOURS);

      const { data, error } = await supabase
        .from('statuses')
        .insert({
          user_id: userId,
          content_type: 'video',
          content_url: result.url,
          thumbnail_url: thumbnailUrl,
          duration: Math.round(duration),
          caption: caption?.trim().slice(0, MAX_CAPTION_LENGTH),
          privacy,
          expires_at: expiresAt.toISOString(),
          view_count: 0
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating video status:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error creating video status:', error);
      return null;
    }
  },

  /**
   * Get my statuses (for viewing my own status)
   */
  async getMyStatuses(userId: string): Promise<Status[]> {
    const { data, error } = await supabase
      .from('statuses')
      .select('*')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching my statuses:', error);
      return [];
    }

    return data || [];
  },

  /**
   * Get contacts' statuses (for status list view)
   */
  async getContactsStatuses(userId: string, contactIds: string[]): Promise<UserStatuses[]> {
    if (contactIds.length === 0) return [];

    // Get all active statuses from contacts
    const { data: statuses, error } = await supabase
      .from('statuses')
      .select('*')
      .in('user_id', contactIds)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching contacts statuses:', error);
      return [];
    }

    if (!statuses || statuses.length === 0) return [];

    // Get unique user IDs from statuses
    const statusUserIds = [...new Set(statuses.map(s => s.user_id))];

    // Fetch profiles for these users
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url, is_online')
      .in('id', statusUserIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    // Get viewed status IDs for this user
    const statusIds = statuses.map(s => s.id);
    const { data: views } = await supabase
      .from('status_views')
      .select('status_id')
      .eq('viewer_id', userId)
      .in('status_id', statusIds);

    const viewedStatusIds = new Set(views?.map(v => v.status_id) || []);

    // Group by user
    const userStatusMap = new Map<string, UserStatuses>();

    for (const status of statuses) {
      const profile = profileMap.get(status.user_id) as UserProfile;
      if (!profile) continue;

      const existing = userStatusMap.get(status.user_id);
      const hasUnviewed = !viewedStatusIds.has(status.id);

      if (existing) {
        existing.statuses.push(status);
        if (hasUnviewed) existing.hasUnviewed = true;
      } else {
        userStatusMap.set(status.user_id, {
          user_id: status.user_id,
          user_profile: profile,
          statuses: [status],
          hasUnviewed,
          lastStatusAt: status.created_at
        });
      }
    }

    // Sort: unviewed first, then by most recent
    return Array.from(userStatusMap.values()).sort((a, b) => {
      if (a.hasUnviewed && !b.hasUnviewed) return -1;
      if (!a.hasUnviewed && b.hasUnviewed) return 1;
      return new Date(b.lastStatusAt).getTime() - new Date(a.lastStatusAt).getTime();
    });
  },

  /**
   * Mark status as viewed
   */
  async viewStatus(statusId: string, viewerId: string): Promise<boolean> {
    // Check if already viewed
    const { data: existing } = await supabase
      .from('status_views')
      .select('id')
      .eq('status_id', statusId)
      .eq('viewer_id', viewerId)
      .single();

    if (existing) return true; // Already viewed

    // Insert view
    const { error } = await supabase
      .from('status_views')
      .insert({
        status_id: statusId,
        viewer_id: viewerId
      });

    if (error) {
      console.error('Error recording status view:', error);
      return false;
    }

    // Update view count
    await supabase.rpc('increment_status_view_count', { status_id: statusId });

    return true;
  },

  /**
   * Get viewers of a status (for status owner)
   */
  async getStatusViewers(statusId: string): Promise<StatusView[]> {
    const { data, error } = await supabase
      .from('status_views')
      .select(`
        *,
        viewer:viewer_id (
          id,
          full_name,
          username,
          avatar_url
        )
      `)
      .eq('status_id', statusId)
      .order('viewed_at', { ascending: false });

    if (error) {
      console.error('Error fetching status viewers:', error);
      return [];
    }

    return (data || []).map(view => ({
      ...view,
      viewer_profile: view.viewer as unknown as UserProfile
    }));
  },

  /**
   * Reply to a status
   */
  async replyToStatus(
    statusId: string,
    senderId: string,
    statusOwnerId: string,
    content: string
  ): Promise<boolean> {
    // Create a direct message as a status reply
    const { error } = await supabase
      .from('messages')
      .insert({
        sender_id: senderId,
        receiver_id: statusOwnerId,
        content: content.trim(),
        type: 'text',
        reply_to: `status:${statusId}` // Special format to identify status replies
      });

    if (error) {
      console.error('Error replying to status:', error);
      return false;
    }

    return true;
  },

  /**
   * Delete a status
   */
  async deleteStatus(statusId: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from('statuses')
      .delete()
      .eq('id', statusId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting status:', error);
      return false;
    }

    return true;
  },

  /**
   * Mute statuses from a user
   */
  async muteUserStatus(userId: string, muteUserId: string): Promise<boolean> {
    const { error } = await supabase
      .from('muted_statuses')
      .upsert({
        user_id: userId,
        muted_user_id: muteUserId
      });

    if (error) {
      console.error('Error muting user status:', error);
      return false;
    }

    return true;
  },

  /**
   * Unmute statuses from a user
   */
  async unmuteUserStatus(userId: string, muteUserId: string): Promise<boolean> {
    const { error } = await supabase
      .from('muted_statuses')
      .delete()
      .eq('user_id', userId)
      .eq('muted_user_id', muteUserId);

    if (error) {
      console.error('Error unmuting user status:', error);
      return false;
    }

    return true;
  },

  /**
   * Get list of muted status users
   */
  async getMutedStatusUsers(userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('muted_statuses')
      .select('muted_user_id')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching muted status users:', error);
      return [];
    }

    return (data || []).map(d => d.muted_user_id);
  },

  /**
   * Subscribe to new statuses from contacts
   */
  subscribeToStatuses(
    userId: string,
    contactIds: string[],
    onNewStatus: (status: Status) => void
  ): { unsubscribe: () => void } {
    const channel = supabase
      .channel(`statuses_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'statuses',
          filter: `user_id=in.(${contactIds.join(',')})`
        },
        (payload) => {
          onNewStatus(payload.new as Status);
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };
  },

  /**
   * Subscribe to views on my statuses
   */
  subscribeToMyStatusViews(
    userId: string,
    onNewView: (view: StatusView) => void
  ): { unsubscribe: () => void } {
    // First get my status IDs
    const channel = supabase
      .channel(`status_views_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'status_views'
        },
        async (payload) => {
          // Check if this view is for one of my statuses
          const { data: status } = await supabase
            .from('statuses')
            .select('user_id')
            .eq('id', payload.new.status_id)
            .single();

          if (status?.user_id === userId) {
            // Get viewer profile
            const { data: viewer } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', payload.new.viewer_id)
              .single();

            onNewView({
              ...payload.new as StatusView,
              viewer_profile: viewer
            });
          }
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };
  }
};

export default statusService;
