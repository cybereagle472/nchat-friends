/**
 * Chat Service - Production-Ready Offline-First Implementation (Cloudflare Worker backend)
 *
 * Features:
 * - Idempotent message sending with client_message_id
 * - Offline queue with automatic retry
 * - Local-first UI updates
 * - Sync reconciliation
 * - Message pre-fetching for instant chat loading (WhatsApp-style)
 * - Realtime updates over a single per-user WebSocket (src/lib/realtimeClient.ts)
 */

import { apiFetch, ApiError } from '../lib/apiClient';
import { realtimeClient } from '../lib/realtimeClient';
import { retry } from '../utils/retry';
import { Message, Contact, UserProfile } from '../types';
import {
  generateClientMessageId,
  getChatId,
  saveMessage,
  saveMessages,
  getChatMessages as getLocalMessages,
  queuePendingMessage,
  getPendingMessages,
  removePendingMessage,
  updatePendingMessageStatus,
  updateMessageSyncStatus,
  getMessageByClientId,
  cacheProfiles,
  isOnline,
  LocalMessage,
  PendingMessage,
  MessageSyncStatus
} from '../utils/offlineStorage';
import { log } from '../utils/logger';
import { RateLimiter } from '../utils/validation';
import { RATE_LIMITS } from '../utils/constants';

// In-memory message cache for INSTANT chat switching
const messageCache = new Map<string, { messages: Message[]; fetchedAt: number }>();
const CACHE_TTL_MS = 60000; // 1 minute cache TTL
const PREFETCH_LIMIT = 30; // Messages to prefetch per chat

const MAX_RETRY_COUNT = 5;
const RETRY_DELAY_MS = 2000;

// Rate limiter for message sending
const messageRateLimiter = new RateLimiter(
  RATE_LIMITS.MESSAGES_PER_MINUTE,
  60000 // 1 minute window
);

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export interface SendMessageParams {
  senderId: string;
  receiverId: string;
  content: string;
  type?: Message['type'];
  duration?: number;
  replyToId?: string;
  /**
   * Optional caller-supplied idempotency id. Pass the same id you used for
   * an optimistic local/UI message so the realtime echo of this exact send
   * (the Worker broadcasts message:new to the sender too) reconciles with
   * it instead of being inserted as a visual duplicate.
   */
  clientMessageId?: string;
}


export interface SendMessageResult {
  success: boolean;
  message?: Message;
  clientMessageId: string;
  error?: string;
  isOffline?: boolean;
}

export const chatService = {
  /**
   * Send a message with offline-first support
   * Returns immediately with optimistic local message
   */
  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const {
      senderId,
      receiverId,
      content,
      type = 'text',
      duration,
      replyToId
    } = params;

    // Rate limiting check
    if (!messageRateLimiter.isAllowed(senderId)) {
      return {
        success: false,
        clientMessageId: params.clientMessageId || generateClientMessageId(),
        error: `Rate limit exceeded. Maximum ${RATE_LIMITS.MESSAGES_PER_MINUTE} messages per minute.`
      };
    }

    // Reuse the caller's id (e.g. a UI's optimistic-message id) when given,
    // so the realtime echo of this exact message reconciles with the local
    // optimistic entry instead of showing up as a second, duplicate message.
    const clientMessageId = params.clientMessageId || generateClientMessageId();
    const chatId = getChatId(senderId, receiverId);
    const now = new Date().toISOString();

    const localMessage: LocalMessage = {
      id: clientMessageId,
      sender_id: senderId,
      receiver_id: receiverId,
      content,
      type,
      duration: duration?.toString(),
      reply_to: replyToId,
      created_at: now,
      is_read: false,
      is_deleted: false,
      deleted_for: [],
      reactions: {},
      chatId,
      syncStatus: 'pending',
      clientMessageId,
      localCreatedAt: now,
      retryCount: 0
    };

    await saveMessage(localMessage);

    if (!isOnline()) {
      const pendingMessage: PendingMessage = {
        clientMessageId,
        senderId,
        receiverId,
        content,
        type,
        duration,
        replyToId,
        createdAt: now,
        retryCount: 0,
        status: 'queued'
      };
      await queuePendingMessage(pendingMessage);

      return {
        success: true,
        message: localMessage as Message,
        clientMessageId,
        isOffline: true
      };
    }

    try {
      const result = await this.sendToServer({
        clientMessageId,
        senderId,
        receiverId,
        content,
        type,
        duration,
        replyToId
      });

      if (result.success && result.message) {
        await updateMessageSyncStatus(
          clientMessageId,
          'sent',
          result.message.id,
          result.message.created_at
        );

        return {
          success: true,
          message: result.message,
          clientMessageId
        };
      } else {
        await updateMessageSyncStatus(clientMessageId, 'failed');

        const pendingMessage: PendingMessage = {
          clientMessageId,
          senderId,
          receiverId,
          content,
          type,
          duration,
          replyToId,
          createdAt: now,
          retryCount: 1,
          status: 'failed'
        };
        await queuePendingMessage(pendingMessage);

        return {
          success: false,
          message: localMessage as Message,
          clientMessageId,
          error: result.error
        };
      }
    } catch (error: any) {
      await updateMessageSyncStatus(clientMessageId, 'failed');

      const pendingMessage: PendingMessage = {
        clientMessageId,
        senderId,
        receiverId,
        content,
        type,
        duration,
        replyToId,
        createdAt: now,
        retryCount: 1,
        status: 'failed'
      };
      await queuePendingMessage(pendingMessage);

      return {
        success: false,
        message: localMessage as Message,
        clientMessageId,
        error: error.message || 'An error occurred'
      };
    }
  },

  /**
   * Send message to server with idempotency (the Worker also de-dupes by
   * client_message_id, so a retried call is always safe)
   */
  async sendToServer(params: {
    clientMessageId: string;
    senderId: string;
    receiverId: string;
    content: string;
    type: string;
    duration?: number;
    replyToId?: string;
  }): Promise<{ success: boolean; message?: Message; error?: string }> {
    try {
      return await retry(async () => {
        const { message } = await apiFetch<{ message: Message }>('/messages', {
          method: 'POST',
          body: JSON.stringify({
            receiver_id: params.receiverId,
            content: params.content,
            type: params.type,
            duration: params.duration,
            reply_to: params.replyToId,
            client_message_id: params.clientMessageId
          })
        });
        return { success: true, message };
      }, {
        maxRetries: 3,
        delay: 1000,
        backoff: true
      });
    } catch (error: any) {
      return { success: false, error: errorMessage(error, 'Failed to send message') };
    }
  },

  /**
   * Process pending message queue (call on reconnect)
   */
  async processPendingQueue(
    onProgress?: (clientMessageId: string, status: 'sending' | 'sent' | 'failed') => void
  ): Promise<{ processed: number; failed: number }> {
    const pendingMessages = await getPendingMessages();
    let processed = 0;
    let failed = 0;

    for (const pending of pendingMessages) {
      if (pending.retryCount >= MAX_RETRY_COUNT) {
        failed++;
        continue;
      }

      onProgress?.(pending.clientMessageId, 'sending');
      await updatePendingMessageStatus(pending.clientMessageId, 'sending');

      if (!pending.receiverId) {
        failed++;
        continue; // Skip group messages in this queue
      }

      try {
        const result = await this.sendToServer({
          clientMessageId: pending.clientMessageId,
          senderId: pending.senderId,
          receiverId: pending.receiverId,
          content: pending.content,
          type: pending.type,
          duration: pending.duration || undefined,
          replyToId: pending.replyToId
        });

        if (result.success) {
          await removePendingMessage(pending.clientMessageId);
          await updateMessageSyncStatus(
            pending.clientMessageId,
            'sent',
            result.message?.id,
            result.message?.created_at
          );
          onProgress?.(pending.clientMessageId, 'sent');
          processed++;
        } else {
          await updatePendingMessageStatus(
            pending.clientMessageId,
            'failed',
            pending.retryCount + 1
          );
          await updateMessageSyncStatus(pending.clientMessageId, 'failed');
          onProgress?.(pending.clientMessageId, 'failed');
          failed++;
        }
      } catch (error) {
        log.error('Failed to process pending message', error, 'chatService');

        await updatePendingMessageStatus(
          pending.clientMessageId,
          'failed',
          pending.retryCount + 1
        );
        await updateMessageSyncStatus(pending.clientMessageId, 'failed');
        onProgress?.(pending.clientMessageId, 'failed');
        failed++;
      }

      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }

    return { processed, failed };
  },

  /**
   * Get messages for a chat - local first, then sync with server
   */
  async getMessages(
    userId: string,
    contactId: string,
    options: {
      limit?: number;
      beforeTimestamp?: string;
      forceServerSync?: boolean;
    } = {}
  ): Promise<Message[]> {
    const { limit = 50, beforeTimestamp, forceServerSync = false } = options;
    const chatId = getChatId(userId, contactId);

    const localMessages = await getLocalMessages(chatId, limit, beforeTimestamp);

    if (!forceServerSync && localMessages.length > 0 && !isOnline()) {
      return localMessages.filter(m => !m.deleted_for?.includes(userId)) as Message[];
    }

    if (isOnline()) {
      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (beforeTimestamp) params.set('before', beforeTimestamp);

        const { messages: serverMessages } = await apiFetch<{ messages: Message[] }>(
          `/messages/with/${contactId}?${params.toString()}`
        );

        if (serverMessages) {
          const localMessagesToSave: LocalMessage[] = serverMessages.map(msg => ({
            ...msg,
            chatId,
            syncStatus: 'sent' as MessageSyncStatus,
            clientMessageId: msg.client_message_id || msg.id,
            localCreatedAt: msg.created_at,
            serverCreatedAt: msg.created_at,
            retryCount: 0
          }));

          await saveMessages(localMessagesToSave);

          const mergedMessages = this.mergeMessages(localMessages, localMessagesToSave);

          // mergeMessages sorts ascending (oldest first), so once a chat has
          // accumulated more than `limit` messages, slicing from the front
          // silently drops the newest ones — including the message that just
          // arrived while the chat was closed. Keep the most recent `limit`
          // instead.
          return mergedMessages
            .filter(m => !m.deleted_for?.includes(userId))
            .slice(-limit) as Message[];
        }
      } catch (error) {
        console.error('Error syncing messages:', error);
      }
    }

    return localMessages.filter(m => !m.deleted_for?.includes(userId)) as Message[];
  },

  /**
   * Merge local and server messages, preferring server versions
   */
  mergeMessages(local: LocalMessage[], server: LocalMessage[]): LocalMessage[] {
    const messageMap = new Map<string, LocalMessage>();

    for (const msg of local) {
      messageMap.set(msg.clientMessageId || msg.id, msg);
    }

    for (const msg of server) {
      const key = msg.clientMessageId || msg.id;
      const existing = messageMap.get(key);

      if (!existing || msg.serverCreatedAt) {
        messageMap.set(key, msg);
      }
    }

    return Array.from(messageMap.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  },

  /**
   * Mark messages as read (the Worker notifies the sender's live session)
   */
  async markAsRead(_userId: string, senderId: string): Promise<void> {
    if (!isOnline()) return;
    try {
      await apiFetch('/messages/mark-read', {
        method: 'POST',
        body: JSON.stringify({ sender_id: senderId })
      });
    } catch (error) {
      log.error('Error marking messages as read', error, 'chatService');
    }
  },

  /**
   * Delete message for self only
   */
  async deleteForMe(messageId: string, _userId: string): Promise<{ success: boolean }> {
    try {
      await apiFetch(`/messages/${messageId}/delete-for-me`, { method: 'POST' });
      return { success: true };
    } catch (error) {
      log.error('Error deleting message for self', error, 'chatService');
      return { success: false };
    }
  },

  /**
   * Delete message for everyone (sender only)
   */
  async deleteForEveryone(
    messageId: string,
    _senderId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await apiFetch(`/messages/${messageId}`, { method: 'DELETE' });
      return { success: true };
    } catch (error) {
      return { success: false, error: errorMessage(error, 'You can only delete your own messages') };
    }
  },

  /**
   * Add reaction to message (the Worker's endpoint toggles, which is what we want here)
   */
  async addReaction(messageId: string, _userId: string, emoji: string): Promise<void> {
    try {
      await apiFetch(`/messages/${messageId}/reaction`, {
        method: 'POST',
        body: JSON.stringify({ emoji })
      });
    } catch (error) {
      log.error('Error adding reaction', error, 'chatService');
    }
  },

  /**
   * Remove reaction from message
   */
  async removeReaction(messageId: string, _userId: string, emoji: string): Promise<void> {
    try {
      // Same toggle endpoint as addReaction — calling it again removes an
      // existing reaction from this user for this emoji.
      await apiFetch(`/messages/${messageId}/reaction`, {
        method: 'POST',
        body: JSON.stringify({ emoji })
      });
    } catch (error) {
      log.error('Error removing reaction', error, 'chatService');
    }
  },

  /**
   * Get chat list with last messages + unread counts
   */
  async getChatList(userId: string, friendIds: string[]): Promise<Contact[]> {
    if (friendIds.length === 0) return [];

    try {
      const { chats } = await apiFetch<{ chats: any[] }>('/messages/chats');
      if (!chats) return [];

      const result: Contact[] = chats.map((row) => ({
        user_id: row.user_id,
        status: 'accepted' as const,
        profile: {
          id: row.profile.id,
          email: row.profile.email || '',
          full_name: row.profile.full_name || '',
          username: row.profile.username,
          avatar_url: row.profile.avatar_url,
          is_online: row.profile.is_online,
          last_seen: row.profile.last_seen
        } as UserProfile,
        lastMessage: row.lastMessage as Message | undefined,
        unreadCount: Number(row.unreadCount) || 0
      }));

      cacheProfiles(result.map(c => c.profile)).catch(() => {});

      return result;
    } catch (error) {
      console.error('Error fetching chat list:', error);
      return this.getChatListFallback(userId, friendIds);
    }
  },

  /**
   * Fallback method if the combined /messages/chats endpoint is unreachable
   */
  async getChatListFallback(userId: string, friendIds: string[]): Promise<Contact[]> {
    try {
      const results = await Promise.all(
        friendIds.map(async (friendId) => {
          const [profileResult, messagesResult] = await Promise.all([
            apiFetch<{ profile: UserProfile }>(`/users/${friendId}`).catch(() => null),
            apiFetch<{ messages: Message[] }>(`/messages/with/${friendId}?limit=1`).catch(() => ({ messages: [] as Message[] }))
          ]);

          if (!profileResult) return null;

          await cacheProfiles([profileResult.profile]).catch(() => {});

          const lastMessage = messagesResult.messages[messagesResult.messages.length - 1];

          return {
            user_id: friendId,
            status: 'accepted' as const,
            profile: profileResult.profile,
            lastMessage,
            unreadCount: lastMessage && lastMessage.receiver_id === userId && !lastMessage.is_read ? 1 : 0
          };
        })
      );

      return (results.filter(Boolean) as Contact[]).sort((a, b) => {
        const aTime = a.lastMessage?.created_at || '0';
        const bTime = b.lastMessage?.created_at || '0';
        return bTime.localeCompare(aTime);
      });
    } catch {
      return [];
    }
  },

  /**
   * Subscribe to message events for this user, across every conversation.
   * Backed by a single shared WebSocket (src/lib/realtimeClient.ts) instead
   * of per-table Supabase subscriptions.
   */
  subscribeToMessages(
    userId: string,
    onNewMessage: (message: Message) => void,
    onUpdate: (message: Message) => void
  ) {
    const subs = [
      realtimeClient.on('message:new', (payload) => {
        const msg = payload.message as Message;
        if (msg.sender_id === userId || msg.receiver_id === userId) {
          // Fire the live UI update immediately and unconditionally. The
          // local-cache (IndexedDB) reconciliation below is best-effort and
          // must never gate it — IndexedDB can throw, or even hang
          // indefinitely (e.g. a blocked version-upgrade across tabs), and
          // none of that should ever be able to delay or swallow a message
          // actually showing up live in the chat.
          onNewMessage(msg);

          if (msg.client_message_id) {
            (async () => {
              try {
                const existingLocal = await getMessageByClientId(msg.client_message_id!);
                if (existingLocal && existingLocal.syncStatus === 'pending') {
                  await updateMessageSyncStatus(existingLocal.id, 'sent', msg.id, msg.created_at);
                }
              } catch (err) {
                log.warn('Failed to reconcile realtime message with local cache', err, 'chatService');
              }
            })();
          }
        }
      }),
      realtimeClient.on('message:edit', (payload) => {
        const msg = payload.message as Message;
        if (msg.sender_id === userId || msg.receiver_id === userId) {
          onUpdate(msg);
        }
      }),
      realtimeClient.on('message:delete', (payload) => {
        if (payload.sender_id === userId || payload.receiver_id === userId) {
          onUpdate({
            id: payload.messageId,
            sender_id: payload.sender_id,
            receiver_id: payload.receiver_id,
            is_deleted: true,
            content: ''
          } as Message);
        }
      }),
      realtimeClient.on('message:reaction', (payload) => {
        if (payload.sender_id === userId || payload.receiver_id === userId) {
          onUpdate({
            id: payload.messageId,
            sender_id: payload.sender_id,
            receiver_id: payload.receiver_id,
            reactions: payload.reactions
          } as Message);
        }
      })
    ];

    return { unsubscribe: () => subs.forEach((s) => s.unsubscribe()) };
  },

  /**
   * Subscribe to read receipts (for sender to know when their messages are read)
   */
  subscribeToReadReceipts(
    _userId: string,
    onMessagesRead: (messageIds: string[], readerId: string) => void
  ) {
    return realtimeClient.on('message:read', (payload) => {
      if (payload.message_ids) onMessagesRead(payload.message_ids, payload.reader_id);
    });
  },

  /**
   * Edit a sent message (only text messages, only by sender — enforced server-side too)
   */
  async editMessage(
    messageId: string,
    _senderId: string,
    newContent: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await apiFetch(`/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: newContent })
      });
      return { success: true };
    } catch (error) {
      log.error('Edit message failed', error, 'chatService');
      return { success: false, error: errorMessage(error, 'Failed to edit message') };
    }
  },

  /**
   * Forward a message to multiple users
   */
  async forwardToUsers(
    senderId: string,
    receiverIds: string[],
    originalMessage: Message
  ): Promise<{ success: boolean; sentCount: number; error?: string }> {
    let sentCount = 0;

    try {
      for (const receiverId of receiverIds) {
        const clientMessageId = generateClientMessageId();

        try {
          await apiFetch('/messages', {
            method: 'POST',
            body: JSON.stringify({
              receiver_id: receiverId,
              content: originalMessage.content,
              type: originalMessage.type,
              media_url: originalMessage.media_url,
              thumbnail_url: originalMessage.thumbnail_url,
              fileName: originalMessage.fileName,
              fileSize: originalMessage.fileSize,
              duration: originalMessage.duration,
              client_message_id: clientMessageId
            })
          });
          sentCount++;
        } catch (error) {
          log.error('Failed to forward message', error, 'chatService');
        }
      }

      void senderId;
      return { success: sentCount > 0, sentCount };
    } catch (error: any) {
      return { success: false, sentCount, error: errorMessage(error, 'Failed to forward message') };
    }
  },

  /**
   * Forward a message to multiple groups
   */
  async forwardToGroups(
    senderId: string,
    groupIds: string[],
    originalMessage: Message
  ): Promise<{ success: boolean; sentCount: number; error?: string }> {
    let sentCount = 0;

    try {
      for (const groupId of groupIds) {
        const clientMessageId = generateClientMessageId();

        try {
          await apiFetch(`/groups/${groupId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
              content: originalMessage.content,
              type: originalMessage.type,
              media_url: originalMessage.media_url,
              thumbnail_url: originalMessage.thumbnail_url,
              client_message_id: clientMessageId
            })
          });
          sentCount++;
        } catch (error) {
          log.error('Failed to forward message to group', error, 'chatService');
        }
      }

      void senderId;
      return { success: sentCount > 0, sentCount };
    } catch (error: any) {
      return { success: false, sentCount, error: errorMessage(error, 'Failed to forward message') };
    }
  },

  /**
   * Pre-fetch messages for multiple chats in background
   * Call this when chat list loads to ensure instant chat opening
   */
  async prefetchChatsMessages(
    userId: string,
    contactIds: string[],
    limit: number = PREFETCH_LIMIT
  ): Promise<void> {
    // Prefetch in batches to avoid overwhelming the server
    const batchSize = 5;

    for (let i = 0; i < contactIds.length; i += batchSize) {
      const batch = contactIds.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (contactId) => {
          const chatId = getChatId(userId, contactId);

          // Skip if already cached and fresh
          const cached = messageCache.get(chatId);
          if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
            return;
          }

          try {
            // First try local cache
            const localMessages = await getLocalMessages(chatId, limit);

            if (localMessages.length > 0) {
              messageCache.set(chatId, {
                messages: localMessages as Message[],
                fetchedAt: Date.now()
              });
            }

            // Background fetch from server if online
            if (isOnline()) {
              const { messages: serverMessages } = await apiFetch<{ messages: Message[] }>(
                `/messages/with/${contactId}?limit=${limit}`
              );

              if (serverMessages && serverMessages.length > 0) {
                messageCache.set(chatId, {
                  messages: serverMessages,
                  fetchedAt: Date.now()
                });

                // Save to IndexedDB for offline access
                const localMessagesToSave: LocalMessage[] = serverMessages.map(msg => ({
                  ...msg,
                  chatId,
                  syncStatus: 'sent' as MessageSyncStatus,
                  clientMessageId: msg.client_message_id || msg.id,
                  localCreatedAt: msg.created_at,
                  serverCreatedAt: msg.created_at,
                  retryCount: 0
                }));
                saveMessages(localMessagesToSave).catch(() => {});
              }
            }
          } catch (error) {
            // Silent fail - prefetching is optional optimization
          }
        })
      );

      // Small delay between batches to be nice to the server
      if (i + batchSize < contactIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  },

  /**
   * Get cached messages instantly (for immediate UI display)
   * Returns null if no cache available
   */
  getCachedMessages(userId: string, contactId: string): Message[] | null {
    const chatId = getChatId(userId, contactId);
    const cached = messageCache.get(chatId);

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS * 5) {
      // Allow slightly stale cache for instant display
      return cached.messages;
    }

    return null;
  },

  /**
   * Update cache with new message (call when message is sent/received)
   */
  updateCache(userId: string, contactId: string, message: Message): void {
    const chatId = getChatId(userId, contactId);
    const cached = messageCache.get(chatId);

    if (cached) {
      // Check if message already exists
      const existingIndex = cached.messages.findIndex(
        m => m.id === message.id ||
             (m.client_message_id && m.client_message_id === message.client_message_id)
      );

      if (existingIndex >= 0) {
        cached.messages[existingIndex] = message;
      } else {
        cached.messages.push(message);
        // Keep sorted by created_at
        cached.messages.sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        // Trim to PREFETCH_LIMIT
        if (cached.messages.length > PREFETCH_LIMIT * 2) {
          cached.messages = cached.messages.slice(-PREFETCH_LIMIT * 2);
        }
      }
    } else {
      messageCache.set(chatId, {
        messages: [message],
        fetchedAt: Date.now()
      });
    }
  },

  /**
   * Clear all message cache (call on logout)
   */
  clearCache(): void {
    messageCache.clear();
  },

  /**
   * Get messages with instant cache-first loading
   * This is the main method to use for WhatsApp-style instant loading
   */
  async getMessagesInstant(
    userId: string,
    contactId: string,
    options: {
      limit?: number;
      beforeTimestamp?: string;
    } = {}
  ): Promise<{ messages: Message[]; fromCache: boolean }> {
    const { limit = 50, beforeTimestamp } = options;
    const chatId = getChatId(userId, contactId);

    // STEP 1: Return cache instantly if available
    const cached = messageCache.get(chatId);
    if (cached && !beforeTimestamp) {
      // Trigger background refresh but return immediately
      this.getMessages(userId, contactId, { limit, forceServerSync: true })
        .then(serverMessages => {
          messageCache.set(chatId, {
            messages: serverMessages,
            fetchedAt: Date.now()
          });
        })
        .catch(() => {});

      return { messages: cached.messages, fromCache: true };
    }

    // STEP 2: Try IndexedDB (still fast, <10ms typically)
    const localMessages = await getLocalMessages(chatId, limit, beforeTimestamp);
    if (localMessages.length > 0) {
      const messages = localMessages as Message[];

      // Update cache
      if (!beforeTimestamp) {
        messageCache.set(chatId, { messages, fetchedAt: Date.now() });
      }

      // Background server sync
      if (isOnline()) {
        this.getMessages(userId, contactId, { limit, forceServerSync: true })
          .then(serverMessages => {
            messageCache.set(chatId, { messages: serverMessages, fetchedAt: Date.now() });
          })
          .catch(() => {});
      }

      return { messages, fromCache: true };
    }

    // STEP 3: Fetch from server (only if no local data)
    const messages = await this.getMessages(userId, contactId, { limit, beforeTimestamp });
    messageCache.set(chatId, { messages, fetchedAt: Date.now() });

    return { messages, fromCache: false };
  }
};
