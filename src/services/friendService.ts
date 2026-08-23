import { api, convex } from '../lib/convexClient';
import type { UserProfile, FriendRequest } from '../types';

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

function mapProfile(u: Record<string, unknown> | null | undefined): UserProfile {
  if (!u) return { id: '', full_name: 'Unknown', email: '' };
  return {
    id: u.id as string,
    full_name: (u.full_name as string) || (u.name as string) || 'User',
    username: u.username as string | undefined,
    email: (u.email as string) ?? '',
    avatar_url: (u.avatar_url ?? u.image) as string | undefined,
    bio: u.bio as string | undefined,
    is_online: false,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function findPendingConnectionId(
  requesterId: string
): Promise<string | null> {
  const raw = await convex.query(api.friends.listAllRequests, {});
  const { received } = raw as { received: Array<Record<string, unknown>> };
  const match = received.find((r) => r.sender_id === requesterId);
  return (match?.id as string) ?? null;
}

export const friendService = {
  async getFriends(_userId: string): Promise<ServiceResult<FriendData>> {
    try {
      const friends = await convex.query(api.friends.listFriends, {});
      const profiles = (friends as unknown as Array<Record<string, unknown>>).map(mapProfile);
      return {
        success: true,
        data: { friends: profiles, friendIds: profiles.map((p) => p.id) },
      };
    } catch (err) {
      return { success: false, error: errMsg(err), code: 'UNKNOWN_ERROR' };
    }
  },

  async getRequests(_userId: string): Promise<ServiceResult<RequestData>> {
    try {
      const raw = await convex.query(api.friends.listAllRequests, {});
      const { received, sent } = raw as {
        received: Array<Record<string, unknown>>;
        sent: Array<Record<string, unknown>>;
      };
      return {
        success: true,
        data: {
          received: received.map(
            (r) =>
              ({
                id: r.id as string,
                sender_id: r.sender_id as string,
                receiver_id: '',
                sender_profile: mapProfile(r.sender_profile as never),
                created_at: (r.created_at as string) ?? new Date().toISOString(),
              }) as FriendRequest
          ),
          sent: sent.map(
            (r) =>
              ({
                id: r.id as string,
                sender_id: '',
                receiver_id: r.receiver_id as string,
                receiver_profile: mapProfile(r.receiver_profile as never),
                created_at: (r.created_at as string) ?? new Date().toISOString(),
              }) as FriendRequest
          ),
        },
      };
    } catch (err) {
      return { success: false, error: errMsg(err), code: 'UNKNOWN_ERROR' };
    }
  },

  async sendRequest(
    _senderId: string,
    receiverId: string,
    _skipChecks = false
  ): Promise<ServiceResult> {
    try {
      await convex.mutation(api.friends.sendFriendRequest, {
        addresseeId: receiverId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err), code: 'REQUEST_FAILED' };
    }
  },

  async cancelRequest(_senderId: string, receiverId: string): Promise<ServiceResult> {
    try {
      await convex.mutation(api.friends.cancelRequest, {
        addresseeId: receiverId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async acceptRequest(requesterId: string, _accepterId: string): Promise<ServiceResult> {
    try {
      const id = await findPendingConnectionId(requesterId);
      if (!id) return { success: false, error: 'Request not found' };
      await convex.mutation(api.friends.respondToFriendRequest, {
        connectionId: id as never,
        accept: true,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async declineRequest(requesterId: string, _accepterId: string): Promise<ServiceResult> {
    try {
      const id = await findPendingConnectionId(requesterId);
      if (!id) return { success: false, error: 'Request not found' };
      await convex.mutation(api.friends.respondToFriendRequest, {
        connectionId: id as never,
        accept: false,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async removeFriend(_userId: string, friendId: string): Promise<ServiceResult> {
    try {
      await convex.mutation(api.friends.removeFriend, {
        friendId: friendId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async blockUser(_userId: string, blockedUserId: string): Promise<ServiceResult> {
    try {
      await convex.mutation(api.friends.blockUser, {
        userId: blockedUserId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async unblockUser(_userId: string, blockedUserId: string): Promise<ServiceResult> {
    try {
      await convex.mutation(api.friends.unblockUser, {
        userId: blockedUserId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async getBlockedUsers(_userId: string): Promise<ServiceResult<UserProfile[]>> {
    try {
      const blocked = await convex.query(api.friends.listBlocked, {});
      return {
        success: true,
        data: (blocked as unknown as Array<Record<string, unknown>>).map(mapProfile),
      };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },
};
