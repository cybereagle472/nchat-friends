/**
 * Group Service — Group Chat Management (Cloudflare Worker backend)
 *
 * Mirrors chatService.ts's shape and conventions: apiFetch against the
 * Worker's /groups routes (worker/src/routes/groups.ts), realtime updates
 * over the single shared per-user WebSocket (src/lib/realtimeClient.ts)
 * instead of Supabase Realtime channels, and the same ServiceResult<T>
 * envelope the rest of the app already expects.
 */

import { apiFetch, ApiError } from '../lib/apiClient';
import { realtimeClient } from '../lib/realtimeClient';
import { mediaService } from './mediaService';
import { Group, GroupMember, GroupMessage, UserProfile } from '../types';
import { generateClientMessageId } from '../utils/offlineStorage';

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CreateGroupParams {
  name: string;
  description?: string;
  avatarFile?: File;
  createdBy: string;
  memberIds: string[];
}

export interface SendGroupMessageParams {
  groupId: string;
  senderId: string;
  content: string;
  type?: GroupMessage['type'];
  replyToId?: string;
  clientMessageId?: string;
}

export interface GroupWithMembers extends Group {
  members: (GroupMember & { profile?: UserProfile })[];
  lastMessage?: GroupMessage;
  unreadCount?: number;
}

export interface GroupSubscription {
  unsubscribe: () => void;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

class GroupService {
  /**
   * Create a new group
   */
  async createGroup(params: CreateGroupParams): Promise<ServiceResult<{ group: Group; members: GroupMember[] }>> {
    const { name, description, avatarFile, memberIds } = params;

    if (!name.trim()) {
      return { success: false, error: 'Group name is required' };
    }

    if (memberIds.length === 0) {
      return { success: false, error: 'At least one member is required' };
    }

    try {
      let avatar_url: string | undefined;
      if (avatarFile) {
        // Best-effort: a failed avatar upload shouldn't block creating the
        // group at all — it just ends up with no picture.
        const uploaded = await mediaService.uploadGroupAvatar(avatarFile, 'new');
        if (uploaded.success) avatar_url = uploaded.url;
      }

      const { group } = await apiFetch<{ group: GroupWithMembers }>('/groups', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description: description?.trim(), avatar_url, memberIds })
      });

      return { success: true, data: { group, members: group.members } };
    } catch (err) {
      console.error('[GroupService] createGroup error:', err);
      return { success: false, error: errorMessage(err, 'Failed to create group') };
    }
  }

  /**
   * Get user's groups with members and last message
   */
  async getUserGroups(_userId: string): Promise<ServiceResult<GroupWithMembers[]>> {
    try {
      const { groups } = await apiFetch<{ groups: GroupWithMembers[] }>('/groups');

      const sorted = [...groups].sort((a, b) => {
        const aTime = a.lastMessage?.created_at || a.created_at;
        const bTime = b.lastMessage?.created_at || b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      return { success: true, data: sorted };
    } catch (err) {
      console.error('[GroupService] getUserGroups error:', err);
      return { success: false, error: errorMessage(err, 'Failed to load groups') };
    }
  }

  /**
   * Get group by ID with members
   */
  async getGroup(groupId: string): Promise<ServiceResult<GroupWithMembers>> {
    try {
      const { group } = await apiFetch<{ group: GroupWithMembers }>(`/groups/${groupId}`);
      return { success: true, data: group };
    } catch (err) {
      console.error('[GroupService] getGroup error:', err);
      return { success: false, error: errorMessage(err, 'Failed to load group') };
    }
  }

  /**
   * Update group info (name/description/avatar) — admins only
   */
  async updateGroup(
    groupId: string,
    _userId: string,
    updates: { name?: string; description?: string; avatarFile?: File }
  ): Promise<ServiceResult<Group>> {
    try {
      let avatar_url: string | undefined;
      if (updates.avatarFile) {
        const uploaded = await mediaService.uploadGroupAvatar(updates.avatarFile, groupId);
        if (!uploaded.success) return { success: false, error: uploaded.error || 'Failed to upload avatar' };
        avatar_url = uploaded.url;
      }

      const { group } = await apiFetch<{ group: Group }>(`/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: updates.name?.trim(),
          description: updates.description?.trim(),
          avatar_url
        })
      });

      return { success: true, data: group };
    } catch (err) {
      console.error('[GroupService] updateGroup error:', err);
      return { success: false, error: errorMessage(err, 'Failed to update group') };
    }
  }

  /**
   * Delete group (admin only)
   */
  async deleteGroup(groupId: string, _userId: string): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/${groupId}`, { method: 'DELETE' });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] deleteGroup error:', err);
      return { success: false, error: errorMessage(err, 'Failed to delete group') };
    }
  }

  /**
   * Add a member to a group (admin only)
   */
  async addMember(groupId: string, _adminId: string, newMemberId: string): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ memberIds: [newMemberId] })
      });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] addMember error:', err);
      return { success: false, error: errorMessage(err, 'Failed to add member') };
    }
  }

  /**
   * Remove a member from a group (admin only, or yourself)
   */
  async removeMember(groupId: string, _adminId: string, memberId: string): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/${groupId}/members/${memberId}`, { method: 'DELETE' });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] removeMember error:', err);
      return { success: false, error: errorMessage(err, 'Failed to remove member') };
    }
  }

  /**
   * Leave group
   */
  async leaveGroup(groupId: string, _userId: string): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/${groupId}/leave`, { method: 'POST' });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] leaveGroup error:', err);
      return { success: false, error: errorMessage(err, 'Failed to leave group') };
    }
  }

  /**
   * Promote member to admin
   */
  async promoteMember(groupId: string, _adminId: string, memberId: string): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/${groupId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' })
      });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] promoteMember error:', err);
      return { success: false, error: errorMessage(err, 'Failed to promote member') };
    }
  }

  /**
   * Demote admin to member
   */
  async demoteMember(groupId: string, _adminId: string, memberId: string): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/${groupId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'member' })
      });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] demoteMember error:', err);
      return { success: false, error: errorMessage(err, 'Failed to demote member') };
    }
  }

  /**
   * Get group messages with pagination
   */
  async getMessages(
    groupId: string,
    options: { limit?: number; beforeTimestamp?: string } = {}
  ): Promise<ServiceResult<GroupMessage[]>> {
    const { limit = 50, beforeTimestamp } = options;

    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (beforeTimestamp) params.set('before', beforeTimestamp);

      const { messages } = await apiFetch<{ messages: GroupMessage[] }>(`/groups/${groupId}/messages?${params}`);
      return { success: true, data: messages };
    } catch (err) {
      console.error('[GroupService] getMessages error:', err);
      return { success: false, error: errorMessage(err, 'Failed to load messages') };
    }
  }

  /**
   * Send group message
   */
  async sendMessage(params: SendGroupMessageParams): Promise<ServiceResult<{ message: GroupMessage; clientMessageId: string; isOffline: boolean }>> {
    const { groupId, senderId, content, type = 'text', replyToId } = params;

    if (!content.trim() && type === 'text') {
      return { success: false, error: 'Message content is required' };
    }

    const clientMessageId = params.clientMessageId || generateClientMessageId();

    try {
      const { message } = await apiFetch<{ message: GroupMessage }>(`/groups/${groupId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: content.trim(),
          type,
          reply_to: replyToId,
          client_message_id: clientMessageId
        })
      });

      return {
        success: true,
        data: { message, clientMessageId, isOffline: false }
      };
    } catch (err) {
      return {
        success: false,
        error: errorMessage(err, 'Failed to send message'),
        data: {
          message: {
            id: clientMessageId,
            group_id: groupId,
            sender_id: senderId,
            content: content.trim(),
            type,
            created_at: new Date().toISOString(),
            reply_to: replyToId,
            client_message_id: clientMessageId
          } as GroupMessage,
          clientMessageId,
          isOffline: true
        }
      };
    }
  }

  /**
   * Delete message for self
   */
  async deleteMessageForMe(messageId: string, _userId: string): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/messages/${messageId}/delete-for-me`, { method: 'POST' });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] deleteMessageForMe error:', err);
      return { success: false, error: errorMessage(err, 'Failed to delete message') };
    }
  }

  /**
   * Delete message for everyone (sender only, within time limit)
   */
  async deleteMessageForEveryone(messageId: string, _senderId: string): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/messages/${messageId}/delete-for-everyone`, { method: 'POST' });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] deleteMessageForEveryone error:', err);
      return { success: false, error: errorMessage(err, 'Failed to delete message') };
    }
  }

  /**
   * Toggle a reaction (adds it if the user hasn't reacted with this emoji
   * yet, removes it otherwise) — same semantics as the 1:1 chat reaction
   * endpoint this mirrors.
   */
  private async toggleReaction(messageId: string, emoji: string): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/messages/${messageId}/reaction`, {
        method: 'POST',
        body: JSON.stringify({ emoji })
      });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] reaction error:', err);
      return { success: false, error: errorMessage(err, 'Failed to update reaction') };
    }
  }

  /** Add reaction to message */
  async addReaction(messageId: string, _userId: string, emoji: string): Promise<ServiceResult<void>> {
    return this.toggleReaction(messageId, emoji);
  }

  /** Remove reaction from message */
  async removeReaction(messageId: string, _userId: string, emoji: string): Promise<ServiceResult<void>> {
    return this.toggleReaction(messageId, emoji);
  }

  /**
   * Mark messages as read. Group messages don't track per-user read
   * receipts server-side (would need its own table) — kept as a no-op so
   * existing call sites keep working without implying a feature that
   * doesn't exist.
   */
  async markAsRead(_groupId: string, _userId: string): Promise<ServiceResult<void>> {
    return { success: true };
  }

  /**
   * Mute/unmute group for the current user
   */
  async toggleMute(groupId: string, _userId: string, muted: boolean): Promise<ServiceResult<void>> {
    try {
      await apiFetch(`/groups/${groupId}/mute`, {
        method: 'PATCH',
        body: JSON.stringify({ muted })
      });
      return { success: true };
    } catch (err) {
      console.error('[GroupService] toggleMute error:', err);
      return { success: false, error: errorMessage(err, 'Failed to update mute setting') };
    }
  }

  /**
   * Subscribe to new/updated/deleted messages for a group. Backed by the
   * single shared per-user WebSocket (src/lib/realtimeClient.ts) — the
   * Worker fans group events out to every member's personal room, so this
   * just filters for the group this caller cares about.
   */
  subscribeToGroupMessages(
    groupId: string,
    onNewMessage: (message: GroupMessage) => void,
    onMessageUpdate?: (message: GroupMessage) => void,
    onMessageDelete?: (messageId: string) => void
  ): GroupSubscription {
    const subs: GroupSubscription[] = [];

    subs.push(
      realtimeClient.on('group-message:new', (payload) => {
        if (payload?.message?.group_id !== groupId) return;
        onNewMessage(payload.message as GroupMessage);
      })
    );

    subs.push(
      realtimeClient.on('group-message:reaction', (payload) => {
        if (payload?.group_id !== groupId || !onMessageUpdate) return;
        onMessageUpdate({ id: payload.message_id, reactions: payload.reactions } as GroupMessage);
      })
    );

    subs.push(
      realtimeClient.on('group-message:delete', (payload) => {
        if (payload?.group_id !== groupId) return;
        onMessageDelete?.(payload.message_id);
      })
    );

    return { unsubscribe: () => subs.forEach((s) => s.unsubscribe()) };
  }

  /**
   * Subscribe to group membership changes (join/leave/role change).
   */
  subscribeToGroupMembers(
    groupId: string,
    onMemberJoin: (member: GroupMember) => void,
    onMemberLeave: (userId: string) => void,
    onMemberUpdate?: (member: GroupMember) => void
  ): GroupSubscription {
    const subs: GroupSubscription[] = [];

    subs.push(
      realtimeClient.on('group-member:joined', (payload) => {
        if (payload?.group_id !== groupId) return;
        (payload.members as GroupMember[] | undefined)?.forEach(onMemberJoin);
      })
    );

    subs.push(
      realtimeClient.on('group-member:left', (payload) => {
        if (payload?.group_id !== groupId) return;
        onMemberLeave(payload.user_id);
      })
    );

    subs.push(
      realtimeClient.on('group-member:updated', (payload) => {
        if (payload?.group_id !== groupId || !onMemberUpdate) return;
        (payload.members as GroupMember[] | undefined)?.forEach(onMemberUpdate);
      })
    );

    return { unsubscribe: () => subs.forEach((s) => s.unsubscribe()) };
  }
}

export const groupService = new GroupService();
export default groupService;
