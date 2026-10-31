/**
 * Status Service - WhatsApp-style Stories/Status
 *
 * Talks to the Cloudflare Worker's /status/* routes (see worker/src/routes/status.ts)
 * and the shared realtime WebSocket for live updates — not Supabase.
 *
 * Features:
 * - Create text, image, video statuses
 * - 24-hour auto-expiry (enforced server-side; `expires_at` is just informational here)
 * - View tracking with real-time updates
 * - Privacy controls (defaults to "contacts"; custom audience lists aren't
 *   supported by the backend yet, see worker schema)
 * - Reply to status (sent as a normal direct message)
 * - Mute status updates from specific users
 */

import { apiFetch, ApiError } from '../lib/apiClient';
import { realtimeClient } from '../lib/realtimeClient';
import { chatService } from './chatService';
import {
  Status,
  StatusView,
  UserStatuses,
  StatusPrivacy,
  UserProfile
} from '../types';
import { mediaService } from './mediaService';

// Constants
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

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

// Raw row shape returned by the Worker for /status/feed (joined with the
// poster's profile columns and a `viewed_by_me` flag).
interface FeedRow extends Status {
  full_name: string;
  username?: string;
  avatar_url?: string;
  viewed_by_me: number | boolean;
}

export const statusService = {
  /**
   * Create a text status
   */
  async createTextStatus(
    _userId: string,
    text: string,
    backgroundColor: string = STATUS_BACKGROUNDS[0],
    fontStyle: string = 'default',
    privacy: StatusPrivacy = 'contacts'
  ): Promise<Status | null> {
    if (!text.trim() || text.length > MAX_TEXT_LENGTH) {
      console.error('[StatusService] Invalid text status content');
      return null;
    }

    try {
      const { status } = await apiFetch<{ status: Status }>('/status', {
        method: 'POST',
        body: JSON.stringify({
          content_type: 'text',
          text_content: text.trim(),
          background_color: backgroundColor,
          font_style: fontStyle,
          privacy
        })
      });
      return status;
    } catch (err) {
      console.error('[StatusService] Error creating text status:', errorMessage(err, 'unknown error'));
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
      const result = await mediaService.uploadMedia(imageFile, userId);
      if (!result.success || !result.url) {
        console.error('Failed to upload status image:', result.error);
        return null;
      }

      const { status } = await apiFetch<{ status: Status }>('/status', {
        method: 'POST',
        body: JSON.stringify({
          content_type: 'image',
          content_url: result.url,
          caption: caption?.trim().slice(0, MAX_CAPTION_LENGTH),
          privacy
        })
      });
      return status;
    } catch (error) {
      console.error('Error creating image status:', errorMessage(error, 'unknown error'));
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
      // mediaService already generates a thumbnail + duration for videos.
      const result = await mediaService.uploadMedia(videoFile, userId);
      if (!result.success || !result.url) {
        console.error('Failed to upload status video:', result.error);
        return null;
      }

      const { status } = await apiFetch<{ status: Status }>('/status', {
        method: 'POST',
        body: JSON.stringify({
          content_type: 'video',
          content_url: result.url,
          thumbnail_url: result.thumbnailUrl,
          duration: result.metadata?.duration ? Math.round(result.metadata.duration) : undefined,
          caption: caption?.trim().slice(0, MAX_CAPTION_LENGTH),
          privacy
        })
      });
      return status;
    } catch (error) {
      console.error('Error creating video status:', errorMessage(error, 'unknown error'));
      return null;
    }
  },

  /**
   * Get my statuses (for viewing my own status)
   */
  async getMyStatuses(_userId: string): Promise<Status[]> {
    try {
      const { statuses } = await apiFetch<{ statuses: Status[] }>('/status/mine');
      return statuses || [];
    } catch (error) {
      console.error('Error fetching my statuses:', errorMessage(error, 'unknown error'));
      return [];
    }
  },

  /**
   * Get contacts' statuses (for status list view)
   */
  async getContactsStatuses(_userId: string, contactIds: string[]): Promise<UserStatuses[]> {
    if (contactIds.length === 0) return [];

    let rows: FeedRow[];
    try {
      const res = await apiFetch<{ statuses: FeedRow[] }>('/status/feed');
      rows = res.statuses || [];
    } catch (error) {
      console.error('Error fetching contacts statuses:', errorMessage(error, 'unknown error'));
      return [];
    }

    if (rows.length === 0) return [];

    // Only keep statuses from people who are still in the current friends
    // list (the feed is already friendship-scoped server-side, but this
    // guards against a stale contactIds list passed in by the caller).
    const contactIdSet = new Set(contactIds);

    const userStatusMap = new Map<string, UserStatuses>();

    for (const row of rows) {
      if (!contactIdSet.has(row.user_id)) continue;

      const profile: UserProfile = {
        id: row.user_id,
        email: '',
        full_name: row.full_name,
        username: row.username,
        avatar_url: row.avatar_url
      } as UserProfile;

      const { full_name: _fn, username: _un, avatar_url: _au, viewed_by_me, ...status } = row;
      const hasUnviewed = !viewed_by_me;

      const existing = userStatusMap.get(row.user_id);
      if (existing) {
        existing.statuses.push(status);
        if (hasUnviewed) existing.hasUnviewed = true;
      } else {
        userStatusMap.set(row.user_id, {
          user_id: row.user_id,
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
  async viewStatus(statusId: string, _viewerId: string): Promise<boolean> {
    try {
      await apiFetch(`/status/${statusId}/view`, { method: 'POST' });
      return true;
    } catch (error) {
      console.error('Error recording status view:', errorMessage(error, 'unknown error'));
      return false;
    }
  },

  /**
   * Get viewers of a status (for status owner)
   */
  async getStatusViewers(statusId: string): Promise<StatusView[]> {
    try {
      const { views } = await apiFetch<{
        views: (StatusView & { full_name: string; username?: string; avatar_url?: string })[];
      }>(`/status/${statusId}/views`);

      return (views || []).map((view) => ({
        id: view.id,
        status_id: view.status_id,
        viewer_id: view.viewer_id,
        viewed_at: view.viewed_at,
        viewer_profile: {
          id: view.viewer_id,
          email: '',
          full_name: view.full_name,
          username: view.username,
          avatar_url: view.avatar_url
        } as UserProfile
      }));
    } catch (error) {
      console.error('Error fetching status viewers:', errorMessage(error, 'unknown error'));
      return [];
    }
  },

  /**
   * Reply to a status — sent as a normal direct message so it shows up in
   * the regular chat with that person, just like WhatsApp does.
   */
  async replyToStatus(
    statusId: string,
    senderId: string,
    statusOwnerId: string,
    content: string
  ): Promise<boolean> {
    const result = await chatService.sendMessage({
      senderId,
      receiverId: statusOwnerId,
      content: content.trim(),
      type: 'text',
      replyToId: `status:${statusId}`
    });
    return result.success;
  },

  /**
   * Delete a status
   */
  async deleteStatus(statusId: string, _userId: string): Promise<boolean> {
    try {
      await apiFetch(`/status/${statusId}`, { method: 'DELETE' });
      return true;
    } catch (error) {
      console.error('Error deleting status:', errorMessage(error, 'unknown error'));
      return false;
    }
  },

  /**
   * Mute statuses from a user
   */
  async muteUserStatus(_userId: string, muteUserId: string): Promise<boolean> {
    try {
      await apiFetch('/status/mute', {
        method: 'POST',
        body: JSON.stringify({ muted_user_id: muteUserId })
      });
      return true;
    } catch (error) {
      console.error('Error muting user status:', errorMessage(error, 'unknown error'));
      return false;
    }
  },

  /**
   * Unmute statuses from a user
   */
  async unmuteUserStatus(_userId: string, muteUserId: string): Promise<boolean> {
    try {
      await apiFetch(`/status/mute/${muteUserId}`, { method: 'DELETE' });
      return true;
    } catch (error) {
      console.error('Error unmuting user status:', errorMessage(error, 'unknown error'));
      return false;
    }
  },

  /**
   * Get list of muted status users
   */
  async getMutedStatusUsers(_userId: string): Promise<string[]> {
    try {
      const { muted } = await apiFetch<{ muted: string[] }>('/status/muted');
      return muted || [];
    } catch (error) {
      console.error('Error fetching muted status users:', errorMessage(error, 'unknown error'));
      return [];
    }
  },

  /**
   * Subscribe to new statuses from contacts (live, via the realtime WebSocket)
   */
  subscribeToStatuses(
    _userId: string,
    _contactIds: string[],
    onNewStatus: (status: Status) => void
  ): { unsubscribe: () => void } {
    const sub = realtimeClient.on('status:new', (payload) => {
      if (payload?.status) onNewStatus(payload.status as Status);
    });
    return { unsubscribe: sub.unsubscribe };
  },

  /**
   * Subscribe to views on my statuses (live, via the realtime WebSocket)
   */
  subscribeToMyStatusViews(
    _userId: string,
    onNewView: (view: StatusView) => void
  ): { unsubscribe: () => void } {
    const sub = realtimeClient.on('status:view', (payload) => {
      if (!payload?.status_id || !payload?.viewer_id) return;
      onNewView({
        id: `${payload.status_id}:${payload.viewer_id}`,
        status_id: payload.status_id,
        viewer_id: payload.viewer_id,
        viewed_at: new Date().toISOString(),
        viewer_profile: payload.viewer_profile as UserProfile | undefined
      });
    });
    return { unsubscribe: sub.unsubscribe };
  }
};

export default statusService;
