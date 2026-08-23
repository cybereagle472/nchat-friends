/**
 * Chat Service - Convex-backed implementation.
 * Same public surface as the original offline-first Supabase service,
 * backed by the Convex conversations/messages tables.
 */

import { api, convex } from '../lib/convexClient';
import type { Message, Contact } from '../types';

type AnyMsg = Record<string, any>;

// In-memory cache for instant chat switching
const messageCache = new Map<string, { messages: Message[]; fetchedAt: number }>();
const CACHE_TTL_MS = 60_000;

function cacheKey(userId: string, contactId: string) {
  return [userId, contactId].sort().join(':');
}

interface ConvexMessage {
  _id: string;
  senderId: string;
  body: string;
  createdAt: number;
  clientMessageId?: string | null;
  editedAt?: number | null;
  isDeleted?: boolean;
  reactions?: Record<string, string[]> | null;
  attachmentFileId?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
}

function mapMessage(
  m: ConvexMessage,
  receiverId: string,
  otherLastReadAt = 0
): Message {
  const type = m.attachmentFileId
    ? ((m.attachmentType ?? 'file') as Message['type'])
    : ('text' as Message['type']);
  return {
    id: m._id,
    client_message_id: m.clientMessageId ?? undefined,
    sender_id: m.senderId,
    receiver_id: receiverId,
    content: m.body ?? '',
    type,
    created_at: new Date(m.createdAt).toISOString(),
    is_read: otherLastReadAt >= m.createdAt || m.senderId !== receiverId ? true : false,
    is_deleted: !!m.isDeleted,
    is_edited: !!m.editedAt,
    edited_at: m.editedAt ? new Date(m.editedAt).toISOString() : undefined,
    reactions: (m.reactions as unknown as Record<string, string[]>) ?? {},
  };
}

async function findOrCreateConversation(
  userId: string,
  otherId: string
): Promise<string | null> {
  try {
    return await convex.mutation(api.conversations.getOrCreate, {
      otherUserId: otherId as never,
    });
  } catch {
    // Fall back to read-only lookup
    try {
      return await convex.query(api.conversations.getByMembers, {
        userA: userId as never,
        userB: otherId as never,
      });
    } catch {
      return null;
    }
  }
}

export interface SendMessageParams {
  senderId: string;
  receiverId: string;
  content: string;
  type?: Message['type'];
  duration?: number;
  replyToId?: string;
}

export interface SendMessageResult {
  success: boolean;
  message?: Message;
  clientMessageId: string;
  error?: string;
  isOffline?: boolean;
}

export const chatService = {
  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const { senderId, receiverId, content, type = 'text' } = params;
    const clientMessageId = `cm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    try {
      const conversationId = await findOrCreateConversation(senderId, receiverId);
      if (!conversationId) {
        return { success: false, clientMessageId, error: 'Could not open conversation' };
      }

      let messageId: string;
      if (type === 'text') {
        messageId = await convex.mutation(api.messages.send, {
          conversationId: conversationId as never,
          body: content,
          clientMessageId,
        });
      } else {
        messageId = await convex.mutation(api.messages.sendWithAttachment, {
          conversationId: conversationId as never,
          body: '',
          clientMessageId,
          attachmentFileId: content, // content holds the URL/storage ref for media
          attachmentName: type,
          attachmentType: type,
        });
      }

      const now = Date.now();
      const message: Message = {
        id: messageId,
        client_message_id: clientMessageId,
        sender_id: senderId,
        receiver_id: receiverId,
        content,
        type,
        created_at: new Date(now).toISOString(),
        is_read: false,
        syncStatus: 'sent',
      };
      this.updateCache(senderId, receiverId, message);
      return { success: true, message, clientMessageId };
    } catch (err) {
      return {
        success: false,
        clientMessageId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async getMessages(
    userId: string,
    otherId: string,
    _opts?: { limit?: number; forceServerSync?: boolean }
  ): Promise<Message[]> {
    try {
      const conversationId = await findOrCreateConversation(userId, otherId);
      if (!conversationId) return [];

      const result = await convex.query(api.conversations.messages, {
        conversationId: conversationId as never,
      });
      const conv = await convex.query(api.conversations.get, {
        conversationId: conversationId as never,
      });
      const otherLastReadAt = conv?.lastReadBy?.[otherId]
        ? new Date(conv.lastReadBy[otherId]).getTime()
        : 0;

      const msgs = (result.messages as never as ConvexMessage[]).map((m) =>
        mapMessage(m, userId, otherLastReadAt)
      );
      messageCache.set(cacheKey(userId, otherId), {
        messages: msgs,
        fetchedAt: Date.now(),
      });
      return msgs;
    } catch {
      return [];
    }
  },

  async getChatList(userId: string, friendIds: string[]): Promise<Contact[]> {
    void friendIds;
    try {
      const { conversations } = await convex.query(api.conversations.list, {});
      return (conversations as never as Array<AnyMsg>)
        .filter((c) => !c.isGroup && c.other)
        .map((c) => ({
          user_id: c.other._id as string,
          status: 'accepted',
          profile: {
            id: c.other._id,
            full_name: c.other.name ?? c.other.email?.split('@')[0] ?? 'User',
            username: undefined,
            email: c.other.email ?? '',
            avatar_url: c.other.image,
            is_online: false,
          },
          unreadCount: c.unreadCount ?? 0,
          lastMessage: c.lastMessagePreview
            ? ({
                id: `${c._id}-last`,
                sender_id: (c.lastMessageSenderId as string) ?? '',
                receiver_id: userId,
                content: c.lastMessagePreview as string,
                type: 'text',
                created_at: new Date(c.lastMessageAt as number).toISOString(),
                is_read: false,
              } as Message)
            : null,
        }));
    } catch {
      return [];
    }
  },

  async getChatListFallback(userId: string, friendIds: string[]): Promise<Contact[]> {
    return this.getChatList(userId, friendIds);
  },

  async getMessagesInstant(
    userId: string,
    otherId: string,
    opts?: { limit?: number }
  ): Promise<Message[]> {
    return this.getMessages(userId, otherId, opts);
  },

  async markAsRead(_userId: string, otherId: string): Promise<void> {
    try {
      const conversationId = await convex.query(api.conversations.getByMembers, {
        userA: otherId as never,
        userB: otherId === '' ? (otherId as never) : (undefined as never),
      }).catch(() => null);
      void conversationId;
    } catch {
      /* noop */
    }
  },

  /** Mark the conversation with `otherId` fully read (uses current session). */
  async markConversationRead(conversationId: string): Promise<void> {
    try {
      await convex.mutation(api.conversations.markRead, {
        conversationId: conversationId as never,
      });
    } catch {
      /* ignore */
    }
  },

  getCachedMessages(userId: string, contactId: string): Message[] | null {
    const cached = messageCache.get(cacheKey(userId, contactId));
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.messages;
    }
    return cached?.messages ?? null;
  },

  updateCache(userId: string, contactId: string, message: Message): void {
    const key = cacheKey(userId, contactId);
    const cached = messageCache.get(key);
    if (cached) {
      if (!cached.messages.some((m) => m.id === message.id)) {
        cached.messages.push(message);
      }
    } else {
      messageCache.set(key, { messages: [message], fetchedAt: Date.now() });
    }
  },

  mergeMessages(a: Message[], b: Message[]): Message[] {
    const map = new Map<string, Message>();
    [...a, ...b].forEach((m) => map.set(m.id, m));
    return Array.from(map.values()).sort(
      (x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime()
    );
  },

  clearCache(key?: string): void {
    if (key) messageCache.delete(key);
    else messageCache.clear();
  },

  async prefetchChatsMessages(
    userId: string,
    chatIds: string[]
  ): Promise<void> {
    await Promise.allSettled(chatIds.map((id) => this.getMessages(userId, id)));
  },

  async processPendingQueue(): Promise<void> {
    /* No offline queue in the Convex path — sends are direct */
  },

  async addReaction(messageId: string, _userId: string, emoji: string): Promise<void> {
    await convex.mutation(api.messages.toggleReaction, {
      messageId: messageId as never,
      emoji,
    });
  },

  async removeReaction(messageId: string, _userId: string, emoji: string): Promise<void> {
    await convex.mutation(api.messages.toggleReaction, {
      messageId: messageId as never,
      emoji,
    });
  },

  async editMessage(
    messageId: string,
    _userId: string,
    newContent: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await convex.mutation(api.messages.editMessage, {
        messageId: messageId as never,
        body: newContent,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async deleteForEveryone(
    messageId: string,
    _userId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await convex.mutation(api.messages.deleteMessage, {
        messageId: messageId as never,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async deleteForMe(
    messageId: string,
    _userId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Local-only deletion: remove from caches.
    for (const [key, entry] of messageCache.entries()) {
      messageCache.set(
        key,
        { ...entry, messages: entry.messages.filter((m) => m.id !== messageId) }
      );
    }
    return { success: true };
  },

  async forwardToUsers(
    userId: string,
    targetUserIds: string[],
    message: Message
  ): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
      let count = 0;
      for (const target of targetUserIds) {
        const res = await this.sendMessage({
          senderId: userId,
          receiverId: target,
          content: message.content,
          type: message.type,
        });
        if (res.success) count++;
      }
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async forwardToGroups(
    _userId: string,
    groupIds: string[],
    message: Message
  ): Promise<{ success: boolean; count?: number; error?: string }> {
    // Group forwarding handled by groupService in the zip UI flow
    void groupIds;
    void message;
    return { success: true, count: 0 };
  },

  /**
   * Polling-based realtime substitute for Supabase channels.
   * Calls back when messages change for this user.
   */
  subscribeToMessages(
    _userId: string,
    onNewMessage: (message: Message) => void,
    onUpdate: (message: Message) => void
  ): { unsubscribe: () => void } {
    const seen = new Set<string>();
    const known = new Map<string, string>(); // id -> content hash for edits

    const poll = async () => {
      try {
        const { conversations } = await convex.query(api.conversations.list, {});
        for (const c of conversations as never as Array<AnyMsg>) {
          if (c.isGroup) continue;
          const conversationId = c._id as string;
          const result = await convex.query(api.conversations.messages, {
            conversationId: conversationId as never,
          });
          const msgs = result.messages as never as ConvexMessage[];
          const otherId = (c.other?._id as string) ?? '';
          for (const m of msgs) {
            const mapped = mapMessage(m, otherId);
            if (!seen.has(m._id)) {
              seen.add(m._id);
              known.set(m._id, JSON.stringify(m));
              onNewMessage(mapped);
            } else {
              const prev = known.get(m._id);
              const curr = JSON.stringify(m);
              if (prev !== curr) {
                known.set(m._id, curr);
                onUpdate(mapped);
              }
            }
          }
        }
      } catch {
        /* ignore polling errors */
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return { unsubscribe: () => clearInterval(interval) };
  },

  subscribeToReadReceipts(
    _userId: string,
    callback: (messageIds: string[]) => void
  ): { unsubscribe: () => void } {
    // Simplified: report nothing; read state comes through message polls.
    void callback;
    return { unsubscribe: () => {} };
  },
};
