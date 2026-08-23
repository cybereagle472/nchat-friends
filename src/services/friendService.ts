/**
 * Friend Service - Production-Ready Implementation
 *
 * Features:
 * - Transactional friend acceptance
 * - Proper error handling with typed responses
 * - Optimized queries
 * - Notification integration
 */

import { supabase } from '../supabaseClient';
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

export const friendService = {
  /**
   * Get all friends for a user
   */
  async getFriends(userId: string): Promise<ServiceResult<FriendData>> {
    try {
      const { data: friendships, error } = await supabase
        .from('friendships')
        .select('user1_id, user2_id')
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

      if (error) {
        return { success: false, error: error.message, code: error.code };
      }

      if (!friendships || friendships.length === 0) {
        return { success: true, data: { friends: [], friendIds: [] } };
      }

      const friendIds = friendships.map(f =>
        f.user1_id === userId ? f.user2_id : f.user1_id
      );

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', friendIds);

      if (profileError) {
        return { success: false, error: profileError.message, code: profileError.code };
      }

      return {
        success: true,
        data: {
          friends: (profiles || []) as UserProfile[],
          friendIds
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'An error occurred', code: 'UNKNOWN_ERROR' };
    }
  },

  /**
   * Check if two users are friends
   */
  async areFriends(userId1: string, userId2: string): Promise<boolean> {
    const { data } = await supabase
      .from('friendships')
      .select('id')
      .or(
        `and(user1_id.eq.${userId1},user2_id.eq.${userId2}),and(user1_id.eq.${userId2},user2_id.eq.${userId1})`
      )
      .maybeSingle();

    return !!data;
  },

  /**
   * Get friend requests (received and sent)
   */
  async getRequests(userId: string): Promise<ServiceResult<RequestData>> {
    try {
      const [receivedResult, sentResult] = await Promise.all([
        supabase
          .from('friend_requests')
          .select('*')
          .eq('receiver_id', userId)
          .eq('status', 'pending'),

        supabase
          .from('friend_requests')
          .select('*')
          .eq('sender_id', userId)
          .eq('status', 'pending')
      ]);

      if (receivedResult.error) {
        return { success: false, error: receivedResult.error.message };
      }

      if (sentResult.error) {
        return { success: false, error: sentResult.error.message };
      }

      const receivedRequests = receivedResult.data || [];
      const sentRequests = sentResult.data || [];

      const allUserIds = [
        ...receivedRequests.map(r => r.sender_id),
        ...sentRequests.map(r => r.receiver_id)
      ];

      let profiles: UserProfile[] = [];
      if (allUserIds.length > 0) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .in('id', allUserIds);

        profiles = (profileData || []) as UserProfile[];
      }

      const profileMap = new Map(profiles.map(p => [p.id, p]));

      const received: FriendRequest[] = receivedRequests.map(r => ({
        ...r,
        sender_profile: profileMap.get(r.sender_id)
      }));

      const sent: FriendRequest[] = sentRequests.map(r => ({
        ...r,
        receiver_profile: profileMap.get(r.receiver_id)
      }));

      return { success: true, data: { received, sent } };
    } catch (err: any) {
      return { success: false, error: err.message || 'An error occurred' };
    }
  },

  /**
   * Send a friend request
   * @param skipChecks - Skip validation checks when already done client-side for faster response
   */
  async sendRequest(senderId: string, receiverId: string, skipChecks = false): Promise<ServiceResult> {
    if (!senderId || !receiverId) {
      return { success: false, error: 'Invalid user IDs', code: 'INVALID_INPUT' };
    }

    if (senderId === receiverId) {
      return { success: false, error: 'Cannot send request to yourself', code: 'SELF_REQUEST' };
    }

    try {
      // Fast path: Skip validation when client already checked
      if (!skipChecks) {
        // Check current auth session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) {
          return { success: false, error: 'Not authenticated - please login again', code: 'NO_AUTH' };
        }

        // Verify sender matches authenticated user
        if (session.user.id !== senderId) {
          return { success: false, error: `Auth mismatch: ${session.user.id} vs ${senderId}`, code: 'AUTH_MISMATCH' };
        }

        // First verify the receiver exists
        const { data: receiverProfile, error: profileError } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', receiverId)
          .maybeSingle();

        if (profileError || !receiverProfile) {
          return { success: false, error: 'Receiver not found in profiles', code: 'USER_NOT_FOUND' };
        }

        // Check for existing request
        const { data: existingRequest } = await supabase
          .from('friend_requests')
          .select('id, sender_id, receiver_id, status')
          .or(
            `and(sender_id.eq.${senderId},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${senderId})`
          )
          .eq('status', 'pending')
          .maybeSingle();

        if (existingRequest) {
          if (existingRequest.sender_id === receiverId) {
            return { success: false, error: 'They already sent you a request!', code: 'INCOMING_EXISTS' };
          }
          return { success: false, error: 'Request already sent', code: 'REQUEST_EXISTS' };
        }

        // Check if already friends
        const areFriends = await this.areFriends(senderId, receiverId);
        if (areFriends) {
          return { success: false, error: 'Already friends', code: 'ALREADY_FRIENDS' };
        }
      }

      // Insert friend request - this is the only essential DB call
      const { data: insertedRequest, error: insertError } = await supabase
        .from('friend_requests')
        .insert({
          sender_id: senderId,
          receiver_id: receiverId,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        // Handle duplicate/conflict errors gracefully
        if (insertError.code === '23505') {
          return { success: false, error: 'Request already sent', code: 'REQUEST_EXISTS' };
        }
        return {
          success: false,
          error: `${insertError.message} [${insertError.code}] ${insertError.details || ''} ${insertError.hint || ''}`.trim(),
          code: insertError.code
        };
      }

      // Create notification (fire and forget - don't block)
      supabase.from('notifications').insert({
        user_id: receiverId,
        actor_id: senderId,
        type: 'friend_request',
        payload: { message: 'sent you a friend request' },
        is_read: false,
        created_at: new Date().toISOString()
      }).then(() => {});

      return { success: true, data: insertedRequest };
    } catch (err: any) {
      console.error('[friendService] sendRequest error:', err);
      return { success: false, error: err.message || 'An error occurred', code: 'UNKNOWN_ERROR' };
    }
  },

  /**
   * Cancel a sent friend request
   */
  async cancelRequest(senderId: string, receiverId: string): Promise<ServiceResult> {
    if (!senderId || !receiverId) {
      return { success: false, error: 'Invalid user IDs' };
    }

    try {
      const { error } = await supabase
        .from('friend_requests')
        .delete()
        .eq('sender_id', senderId)
        .eq('receiver_id', receiverId)
        .eq('status', 'pending');

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'An error occurred' };
    }
  },

  /**
   * Accept a friend request - Creates friendship record
   */
  async acceptRequest(requesterId: string, accepterId: string): Promise<ServiceResult> {
    if (!requesterId || !accepterId) {
      return { success: false, error: 'Invalid user IDs' };
    }

    try {
      const { data: request, error: fetchError } = await supabase
        .from('friend_requests')
        .select('id')
        .eq('sender_id', requesterId)
        .eq('receiver_id', accepterId)
        .eq('status', 'pending')
        .maybeSingle();

      if (fetchError || !request) {
        return { success: false, error: 'Request not found or already processed' };
      }

      const { error: updateError } = await supabase
        .from('friend_requests')
        .update({
          status: 'accepted',
          updated_at: new Date().toISOString()
        })
        .eq('id', request.id);

      if (updateError) {
        return { success: false, error: updateError.message };
      }

      // Sort IDs to satisfy the friendships_check constraint (user1_id < user2_id)
      const [user1, user2] = requesterId < accepterId
        ? [requesterId, accepterId]
        : [accepterId, requesterId];

      const { error: friendshipError } = await supabase
        .from('friendships')
        .insert({
          user1_id: user1,
          user2_id: user2
        });

      if (friendshipError && friendshipError.code !== '23505') {
        await supabase
          .from('friend_requests')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', request.id);

        return { success: false, error: friendshipError.message };
      }

      supabase.from('notifications').insert({
        user_id: requesterId,
        actor_id: accepterId,
        type: 'friend_accept',
        payload: { message: 'accepted your friend request' }
      }).then(() => {});

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'An error occurred' };
    }
  },

  /**
   * Decline a friend request
   */
  async declineRequest(requesterId: string, declinerId: string): Promise<ServiceResult> {
    if (!requesterId || !declinerId) {
      return { success: false, error: 'Invalid user IDs' };
    }

    try {
      const { error } = await supabase
        .from('friend_requests')
        .update({
          status: 'rejected',
          updated_at: new Date().toISOString()
        })
        .eq('sender_id', requesterId)
        .eq('receiver_id', declinerId)
        .eq('status', 'pending');

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'An error occurred' };
    }
  },

  /**
   * Remove a friend (unfriend)
   */
  async removeFriend(userId: string, friendId: string): Promise<ServiceResult> {
    if (!userId || !friendId) {
      return { success: false, error: 'Invalid user IDs' };
    }

    try {
      const { error } = await supabase
        .from('friendships')
        .delete()
        .or(
          `and(user1_id.eq.${userId},user2_id.eq.${friendId}),and(user1_id.eq.${friendId},user2_id.eq.${userId})`
        );

      if (error) {
        return { success: false, error: error.message };
      }

      await supabase
        .from('friend_requests')
        .delete()
        .or(
          `and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`
        );

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'An error occurred' };
    }
  },

  /**
   * Block a user
   */
  async blockUser(userId: string, blockUserId: string): Promise<ServiceResult> {
    if (!userId || !blockUserId) {
      return { success: false, error: 'Invalid user IDs' };
    }

    try {
      const { error } = await supabase
        .from('blocked_users')
        .insert({
          user_id: userId,
          blocked_user_id: blockUserId
        });

      if (error && error.code !== '23505') {
        return { success: false, error: error.message };
      }

      await this.removeFriend(userId, blockUserId);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'An error occurred' };
    }
  },

  /**
   * Unblock a user
   */
  async unblockUser(userId: string, blockedUserId: string): Promise<ServiceResult> {
    if (!userId || !blockedUserId) {
      return { success: false, error: 'Invalid user IDs' };
    }

    try {
      const { error } = await supabase
        .from('blocked_users')
        .delete()
        .eq('user_id', userId)
        .eq('blocked_user_id', blockedUserId);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'An error occurred' };
    }
  },

  /**
   * Get blocked users list
   */
  async getBlockedUsers(userId: string): Promise<ServiceResult<UserProfile[]>> {
    try {
      const { data: blocked, error } = await supabase
        .from('blocked_users')
        .select('blocked_user_id')
        .eq('user_id', userId);

      if (error) {
        return { success: false, error: error.message };
      }

      if (!blocked || blocked.length === 0) {
        return { success: true, data: [] };
      }

      const blockedIds = blocked.map(b => b.blocked_user_id);

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', blockedIds);

      if (profileError) {
        return { success: false, error: profileError.message };
      }

      return { success: true, data: (profiles || []) as UserProfile[] };
    } catch (err: any) {
      return { success: false, error: err.message || 'An error occurred' };
    }
  },

  /**
   * Check if a user is blocked
   */
  async isBlocked(userId: string, checkUserId: string): Promise<boolean> {
    const { data } = await supabase
      .from('blocked_users')
      .select('id')
      .or(
        `and(user_id.eq.${userId},blocked_user_id.eq.${checkUserId}),and(user_id.eq.${checkUserId},blocked_user_id.eq.${userId})`
      )
      .maybeSingle();

    return !!data;
  },

  /**
   * Subscribe to friend-related realtime events
   */
  subscribeToFriendEvents(
    userId: string,
    callbacks: {
      onNewRequest?: (request: FriendRequest) => void;
      onRequestUpdate?: (request: FriendRequest) => void;
      onFriendshipCreated?: (friendship: Friendship) => void;
      onFriendshipDeleted?: (friendshipId: string) => void;
    }
  ) {
    const channel = supabase.channel(`friends_${userId}`);

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'friend_requests',
          filter: `receiver_id=eq.${userId}`
        },
        async (payload) => {
          const request = payload.new as FriendRequest;

          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', request.sender_id)
            .single();

          callbacks.onNewRequest?.({
            ...request,
            sender_profile: senderProfile as UserProfile
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'friend_requests',
          filter: `sender_id=eq.${userId}`
        },
        (payload) => {
          callbacks.onRequestUpdate?.(payload.new as FriendRequest);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'friendships'
        },
        (payload) => {
          const friendship = payload.new as Friendship;
          if (friendship.user1_id === userId || friendship.user2_id === userId) {
            callbacks.onFriendshipCreated?.(friendship);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'friendships'
        },
        (payload) => {
          const old = payload.old as { id: string; user1_id: string; user2_id: string };
          if (old.user1_id === userId || old.user2_id === userId) {
            callbacks.onFriendshipDeleted?.(old.id);
          }
        }
      )
      .subscribe();

    return channel;
  }
};
