/**
 * Friend Service — Cloudflare Worker API
 *
 * Replaces the old direct-to-Supabase implementation. All reads/writes go
 * through the Worker's /friends/* routes (backed by D1), and incoming
 * friend-request / accept / decline events arrive live over the shared
 * realtime WebSocket (see src/lib/realtimeClient.ts).
 */

import { apiFetch, ApiError } from '../lib/apiClient';
import { realtimeClient } from '../lib/realtimeClient';
import { UserProfile, FriendRequest, Friendship } from '../types';

export interface ServiceResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface FriendData {
  friends: UserProfile[];
  friendIds: string[];
}

export interface RequestData {
  received: FriendRequest[];
  sent: FriendRequest[];
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export const friendService = {
  /** Get all friends for a user */
  async getFriends(_userId: string): Promise<ServiceResult<FriendData>> {
    try {
      const { friends } = await apiFetch<{ friends: { id: string; profile: UserProfile }[] }>('/friends');
      return {
        success: true,
        data: {
          friends: friends.map((f) => f.profile),
          friendIds: friends.map((f) => f.id)
        }
      };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to load friends') };
    }
  },

  /** Check if two users are friends */
  async areFriends(userId1: string, userId2: string): Promise<boolean> {
    const result = await this.getFriends(userId1);
    return !!result.data?.friendIds.includes(userId2);
  },

  /** Get friend requests (received and sent) */
  async getRequests(_userId: string): Promise<ServiceResult<RequestData>> {
    try {
      const [{ requests }, sentResult] = await Promise.all([
        apiFetch<{ requests: FriendRequest[] }>('/friends/requests'),
        apiFetch<{ requests: { id: string; receiver_id: string; created_at: string; updated_at: string }[] }>(
          '/friends/sent'
        )
      ]);

      const sent: FriendRequest[] = sentResult.requests.map((r) => ({
        id: r.id,
        sender_id: _userId,
        receiver_id: r.receiver_id,
        status: 'pending',
        created_at: r.created_at,
        updated_at: r.updated_at
      }));

      return { success: true, data: { received: requests, sent } };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to load friend requests') };
    }
  },

  /** Send a friend request */
  async sendRequest(_senderId: string, receiverId: string, _skipChecks = false): Promise<ServiceResult> {
    if (!receiverId) return { success: false, error: 'Invalid user id', code: 'INVALID_INPUT' };
    try {
      const data = await apiFetch<{ success: boolean; id: string }>('/friends/request', {
        method: 'POST',
        body: JSON.stringify({ receiver_id: receiverId })
      });
      return { success: true, data: data as any };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to send friend request') };
    }
  },

  /** Cancel a sent friend request */
  async cancelRequest(_senderId: string, receiverId: string): Promise<ServiceResult> {
    try {
      const { requests } = await apiFetch<{ requests: { id: string; receiver_id: string }[] }>('/friends/sent');
      const request = requests.find((r) => r.receiver_id === receiverId);
      if (!request) return { success: true }; // already gone — nothing to do

      await apiFetch(`/friends/request/${request.id}`, { method: 'DELETE' });
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to cancel request') };
    }
  },

  /** Accept a friend request */
  async acceptRequest(requesterId: string, _accepterId: string): Promise<ServiceResult> {
    try {
      const { requests } = await apiFetch<{ requests: FriendRequest[] }>('/friends/requests');
      const request = requests.find((r) => r.sender_id === requesterId);
      if (!request) return { success: false, error: 'Request not found or already processed' };

      await apiFetch(`/friends/${request.id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ accept: true })
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to accept request') };
    }
  },

  /** Decline a friend request */
  async declineRequest(requesterId: string, _declinerId: string): Promise<ServiceResult> {
    try {
      const { requests } = await apiFetch<{ requests: FriendRequest[] }>('/friends/requests');
      const request = requests.find((r) => r.sender_id === requesterId);
      if (!request) return { success: false, error: 'Request not found or already processed' };

      await apiFetch(`/friends/${request.id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ accept: false })
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to decline request') };
    }
  },

  /** Remove a friend (unfriend) */
  async removeFriend(_userId: string, friendId: string): Promise<ServiceResult> {
    try {
      await apiFetch(`/friends/${friendId}`, { method: 'DELETE' });
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to remove friend') };
    }
  },

  /** Block a user */
  async blockUser(_userId: string, blockUserId: string): Promise<ServiceResult> {
    try {
      await apiFetch('/friends/block', { method: 'POST', body: JSON.stringify({ user_id: blockUserId }) });
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to block user') };
    }
  },

  /** Unblock a user */
  async unblockUser(_userId: string, blockedUserId: string): Promise<ServiceResult> {
    try {
      await apiFetch('/friends/unblock', { method: 'POST', body: JSON.stringify({ user_id: blockedUserId }) });
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to unblock user') };
    }
  },

  /** Get blocked users list */
  async getBlockedUsers(_userId: string): Promise<ServiceResult<UserProfile[]>> {
    try {
      const { blocked } = await apiFetch<{ blocked: UserProfile[] }>('/friends/blocked');
      return { success: true, data: blocked };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to load blocked users') };
    }
  },

  /** Check if a user is blocked (either direction) */
  async isBlocked(userId: string, checkUserId: string): Promise<boolean> {
    const result = await this.getBlockedUsers(userId);
    return !!result.data?.some((u) => u.id === checkUserId);
  },

  /** Subscribe to friend-related realtime events (new request / accepted / declined) */
  subscribeToFriendEvents(
    _userId: string,
    callbacks: {
      onNewRequest?: (request: FriendRequest) => void;
      onRequestUpdate?: (request: FriendRequest) => void;
      onFriendshipCreated?: (friendship: Friendship) => void;
      onFriendshipDeleted?: (friendshipId: string) => void;
    }
  ) {
    const subs = [
      realtimeClient.on('friend:request', (payload) => {
        callbacks.onNewRequest?.(payload.request as FriendRequest);
      }),
      realtimeClient.on('friend:accepted', (payload) => {
        callbacks.onFriendshipCreated?.({
          id: '',
          user1_id: _userId,
          user2_id: payload.friend?.id,
          created_at: new Date().toISOString()
        });
      })
    ];

    return {
      unsubscribe: () => subs.forEach((s) => s.unsubscribe())
    };
  }
};
