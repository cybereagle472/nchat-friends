/**
 * Group Service - Convex-backed implementation.
 * Same public surface as the original Supabase service, backed by the
 * Convex conversations (isGroup) and messages tables.
 */

import { api, convex } from '../lib/convexClient';
import { Group, GroupMember, GroupMessage, UserProfile } from '../types';

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
}

export interface GroupWithMembers extends Group {
  members: (GroupMember & { profile?: UserProfile })[];
  lastMessage?: GroupMessage;
  unreadCount?: number;
}

type AnyRec = Record<string, any>;

function mapProfile(u: AnyRec | null | undefined): UserProfile {
  if (!u) return { id: '', full_name: 'Unknown', email: '' };
  return {
    id: u._id ?? u.id,
    full_name: u.full_name || u.name || 'User',
    username: u.username,
    email: u.email ?? '',
    avatar_url: u.avatar_url ?? u.image,
    bio: u.bio,
    is_online: false,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mapGroupMessage(m: AnyRec, groupId: string): GroupMessage {
  return {
    id: m._id,
    group_id: groupId,
    sender_id: m.senderId,
    content: m.body ?? '',
    type: m.attachmentFileId ? ((m.attachmentType as string) ?? 'file') : 'text',
    created_at: new Date(m.createdAt).toISOString(),
    is_read: false,
    is_deleted: !!m.isDeleted,
    is_edited: !!m.editedAt,
    edited_at: m.editedAt ? new Date(m.editedAt).toISOString() : undefined,
    reactions: (m.reactions as unknown as Record<string, string[]>) ?? {},
    client_message_id: m.clientMessageId ?? undefined,
    syncStatus: 'sent',
  } as unknown as GroupMessage;
}

class GroupService {
  async createGroup(
    params: CreateGroupParams
  ): Promise<ServiceResult<{ group: Group; members: GroupMember[] }>> {
    try {
      void params.avatarFile; // avatar upload handled via mediaService separately
      const groupId = await convex.mutation(api.groups.create, {
        name: params.name,
        memberIds: params.memberIds as never,
      });
      const group: Group = {
        id: groupId,
        name: params.name,
        description: params.description,
        created_by: params.createdBy,
        created_at: new Date().toISOString(),
      };
      const members: GroupMember[] = [params.createdBy, ...params.memberIds].map(
        (uid) => ({
          group_id: groupId,
          user_id: uid,
          role: uid === params.createdBy ? ('admin' as const) : ('member' as const),
          joined_at: new Date().toISOString(),
        })
      );
      return { success: true, data: { group, members } };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async getUserGroups(_userId: string): Promise<ServiceResult<GroupWithMembers[]>> {
    try {
      const { conversations } = await convex.query(api.conversations.list, {});
      const groups = (conversations as unknown as AnyRec[]).filter((c) => c.isGroup);

      const result: GroupWithMembers[] = [];
      for (const g of groups) {
        const detail = await this.getGroup(g._id as string);
        if (detail.success && detail.data) result.push(detail.data);
      }
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async getGroup(groupId: string): Promise<ServiceResult<GroupWithMembers>> {
    try {
      const conv = await convex.query(api.conversations.get, {
        conversationId: groupId as never,
      });
      if (!conv) return { success: false, error: 'Group not found' };

      const membersRaw = (await convex
        .query(api.groups.members, { conversationId: groupId as never })
        .catch(() => [])) as unknown as AnyRec[];

      const members: (GroupMember & { profile?: UserProfile })[] = membersRaw.map(
        (m) => ({
          group_id: groupId,
          user_id: m._id,
          role: m.isAdmin ? ('admin' as const) : ('member' as const),
          joined_at: new Date(0).toISOString(),
          profile: mapProfile(m),
        })
      );

      // Latest message for preview
      let lastMessage: GroupMessage | undefined;
      try {
        const res = await convex.query(api.conversations.messages, {
          conversationId: groupId as never,
        });
        const msgs = res.messages as unknown as AnyRec[];
        const last = msgs[msgs.length - 1];
        if (last && !last.isDeleted) lastMessage = mapGroupMessage(last, groupId);
      } catch {
        /* no messages */
      }

      return {
        success: true,
        data: {
          id: conv._id,
          name: conv.name ?? 'Group',
          created_by: conv.createdById ?? '',
          created_at: new Date(conv._creationTime).toISOString(),
          members,
          lastMessage,
          unreadCount: 0,
        },
      };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async updateGroup(
    groupId: string,
    userId: string,
    updates: Partial<Pick<Group, 'name' | 'description' | 'avatar_url'>>
  ): Promise<ServiceResult<GroupWithMembers>> {
    try {
      void userId;
      if (updates.name !== undefined) {
        await convex.mutation(api.groups.rename, {
          conversationId: groupId as never,
          name: updates.name,
        });
      }
      return await this.getGroup(groupId);
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async deleteGroup(groupId: string, _userId: string): Promise<ServiceResult<void>> {
    // Leave until the group auto-deletes (<2 members remain).
    return this.leaveGroup(groupId, _userId);
  }

  async addMember(
    groupId: string,
    _adminId: string,
    newMemberId: string
  ): Promise<ServiceResult<GroupMember>> {
    try {
      await convex.mutation(api.groups.addMembers, {
        conversationId: groupId as never,
        userIds: [newMemberId] as never,
      });
      return {
        success: true,
        data: {
          group_id: groupId,
          user_id: newMemberId,
          role: 'member',
          joined_at: new Date().toISOString(),
        },
      };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async removeMember(
    groupId: string,
    _adminId: string,
    memberId: string
  ): Promise<ServiceResult<void>> {
    try {
      await convex.mutation(api.groups.removeMember, {
        conversationId: groupId as never,
        memberId: memberId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async leaveGroup(groupId: string, _userId: string): Promise<ServiceResult<void>> {
    try {
      await convex.mutation(api.groups.leave, {
        conversationId: groupId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async promoteMember(_g: string, _a: string, _m: string): Promise<ServiceResult<void>> {
    return { success: false, error: 'Roles are fixed in this version' };
  }

  async demoteMember(_g: string, _a: string, _m: string): Promise<ServiceResult<void>> {
    return { success: false, error: 'Roles are fixed in this version' };
  }

  async getMessages(
    groupId: string,
    opts?: { limit?: number; beforeTimestamp?: string | number }
  ): Promise<ServiceResult<GroupMessage[]>> {
    try {
      const rawBefore = opts?.beforeTimestamp;
      const cursor = rawBefore ? new Date(rawBefore).getTime() : undefined;
      const res = await convex.query(api.conversations.messages, {
        conversationId: groupId as never,
        cursor,
      });
      const all = (res.messages as unknown as AnyRec[]).filter(
        (m) => !m.isDeleted
      );
      const limit = opts?.limit ?? all.length;
      // Return the OLDEST `limit` messages when paginating backwards.
      const page = all.slice(0, Math.min(limit, all.length));
      const msgs = page.map((m) => mapGroupMessage(m, groupId));
      return { success: true, data: msgs };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async sendMessage(
    params: SendGroupMessageParams
  ): Promise<
    ServiceResult<{ message: GroupMessage; clientMessageId: string; isOffline: boolean }>
  > {
    const clientMessageId = `gm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    try {
      const type = params.type ?? 'text';
      let messageId: string;
      if (type === 'text') {
        messageId = await convex.mutation(api.messages.send, {
          conversationId: params.groupId as never,
          body: params.content,
          clientMessageId,
        });
      } else {
        messageId = await convex.mutation(api.messages.sendWithAttachment, {
          conversationId: params.groupId as never,
          body: '',
          clientMessageId,
          attachmentFileId: params.content,
          attachmentName: String(type),
          attachmentType: String(type),
        });
      }
      const message: GroupMessage = mapGroupMessage(
        { _id: messageId, senderId: params.senderId, body: params.content, createdAt: Date.now(), clientMessageId, attachmentType: type === 'text' ? null : type, attachmentFileId: type === 'text' ? null : params.content },
        params.groupId
      );
      return {
        success: true,
        data: { message, clientMessageId, isOffline: false },
      };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async deleteMessageForMe(messageId: string, _userId: string): Promise<ServiceResult<void>> {
    // Local-only deletion isn't persisted in this version.
    void messageId;
    return { success: true };
  }

  async deleteMessageForEveryone(messageId: string, _senderId: string): Promise<ServiceResult<void>> {
    try {
      await convex.mutation(api.messages.deleteMessage, {
        messageId: messageId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async addReaction(messageId: string, _userId: string, emoji: string): Promise<ServiceResult<void>> {
    try {
      await convex.mutation(api.messages.toggleReaction, {
        messageId: messageId as never,
        emoji,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async removeReaction(messageId: string, _userId: string, emoji: string): Promise<ServiceResult<void>> {
    try {
      await convex.mutation(api.messages.toggleReaction, {
        messageId: messageId as never,
        emoji,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  async markAsRead(groupId: string, _userId: string): Promise<ServiceResult<void>> {
    try {
      await convex.mutation(api.conversations.markRead, {
        conversationId: groupId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  }

  /** Polling substitute for Supabase realtime channel. */
  subscribeToGroupMessages(
    groupId: string,
    onNewMessage: (message: GroupMessage) => void,
    onUpdate?: (message: GroupMessage) => void
  ): { unsubscribe: () => void } {
    const seen = new Set<string>();
    const known = new Map<string, string>();

    const poll = async () => {
      try {
        const res = await convex.query(api.conversations.messages, {
          conversationId: groupId as never,
        });
        for (const m of res.messages as unknown as AnyRec[]) {
          if (!seen.has(m._id)) {
            seen.add(m._id);
            known.set(m._id, JSON.stringify(m));
            onNewMessage(mapGroupMessage(m, groupId));
          } else {
            const curr = JSON.stringify(m);
            if (known.get(m._id) !== curr) {
              known.set(m._id, curr);
              onUpdate?.(mapGroupMessage(m, groupId));
            }
          }
        }
      } catch {
        /* ignore */
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return { unsubscribe: () => clearInterval(interval) };
  }

  subscribeToGroupMembers(
    groupId: string,
    onJoin: (member: GroupMember & { profile?: UserProfile }) => void,
    onLeave?: (userId: string) => void,
    onUpdate?: (member: GroupMember & { profile?: UserProfile }) => void
  ): { unsubscribe: () => void } {
    let knownIds = new Set<string>();
    let knownSig = new Map<string, string>();
    let firstRun = true;

    const poll = async () => {
      try {
        const raw = (await convex.query(api.groups.members, {
          conversationId: groupId as never,
        })) as unknown as AnyRec[];
        const members: (GroupMember & { profile?: UserProfile })[] = raw.map(
          (m) => ({
            group_id: groupId,
            user_id: m._id,
            role: m.isAdmin ? ('admin' as const) : ('member' as const),
            joined_at: new Date(0).toISOString(),
            profile: mapProfile(m),
          })
        );
        const ids = new Set(members.map((m) => m.user_id));

        if (!firstRun) {
          for (const m of members) {
            if (!knownIds.has(m.user_id)) onJoin(m);
            else if (knownSig.get(m.user_id) !== JSON.stringify(m)) onUpdate?.(m);
          }
          for (const id of knownIds) {
            if (!ids.has(id)) onLeave?.(id);
          }
        }
        firstRun = false;
        knownIds = ids;
        knownSig = new Map(members.map((m) => [m.user_id, JSON.stringify(m)]));
      } catch {
        /* ignore */
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return { unsubscribe: () => clearInterval(interval) };
  }

  async toggleMute(_groupId: string, _userId: string, _muted: boolean): Promise<ServiceResult<void>> {
    /* Mute state is local-only in this version */
    return { success: true };
  }
}

export const groupService = new GroupService();
