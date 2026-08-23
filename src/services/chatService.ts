/**
 * Chat Service - Production-Ready Offline-First Implementation
 *
 * Features:
 * - Idempotent message sending with client_message_id
 * - Offline queue with automatic retry
 * - Local-first UI updates
 * - Sync reconciliation
 * - Optimized batch queries
 * - Message pre-fetching for instant chat loading (WhatsApp-style)
 */

import { supabase } from '../supabaseClient';
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
        clientMessageId: generateClientMessageId(),
        error: `Rate limit exceeded. Maximum ${RATE_LIMITS.MESSAGES_PER_MINUTE} messages per minute.`
      };
    }

    const clientMessageId = generateClientMessageId();
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
   * Send message to server with idempotency
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
    // Retry logic for transient errors
    try {
      return await retry(async () => {
        const { data: existing } = await supabase
          .from('messages')
          .select('*')
          .eq('client_message_id', params.clientMessageId)
          .maybeSingle();

        if (existing) {
          return { success: true, message: existing as Message };
        }

        const { data, error } = await supabase
          .from('messages')
          .insert({
            sender_id: params.senderId,
            receiver_id: params.receiverId,
            content: params.content,
            type: params.type,
            message_type: params.type,
            duration: params.duration,
            replied_to_id: params.replyToId,
            client_message_id: params.clientMessageId
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505' && error.message?.includes('client_message_id')) {
            const { data: existingMsg } = await supabase
              .from('messages')
              .select('*')
              .eq('client_message_id', params.clientMessageId)
              .single();

            if (existingMsg) {
              return { success: true, message: existingMsg as Message };
            }
          }
          throw new Error(error.message || 'Failed to send message');
        }

        return { success: true, message: data as Message };
      }, {
        maxRetries: 3,
        delay: 1000,
        backoff: true
      });
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to send message' };
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
        let query = supabase
          .from('messages')
          .select('*')
          .or(
            `and(sender_id.eq.${userId},receiver_id.eq.${contactId}),and(sender_id.eq.${contactId},receiver_id.eq.${userId})`
          )
          .order('created_at', { ascending: false })
          .limit(limit);

        if (beforeTimestamp) {
          query = query.lt('created_at', beforeTimestamp);
        }

        const { data: serverMessages, error } = await query;

        if (!error && serverMessages) {
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

          return mergedMessages
            .filter(m => !m.deleted_for?.includes(userId))
            .slice(0, limit) as Message[];
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
   * Mark messages as read
   */
  async markAsRead(userId: string, senderId: string): Promise<void> {
    if (!isOnline()) return;

    // First get the IDs of messages to be marked as read
    const { data: unreadMessages } = await supabase
      .from('messages')
      .select('id')
      .eq('sender_id', senderId)
      .eq('receiver_id', userId)
      .eq('is_read', false);

    if (!unreadMessages || unreadMessages.length === 0) return;

    const messageIds = unreadMessages.map(m => m.id);

    // Update messages as read
    await supabase
      .from('messages')
      .update({ is_read: true })
      .in('id', messageIds);

    // Broadcast read receipt event to notify the sender
    const channel = supabase.channel(`read_receipts_${senderId}`);
    await channel.send({
      type: 'broadcast',
      event: 'messages_read',
      payload: {
        reader_id: userId,
        message_ids: messageIds
      }
    });
    await channel.unsubscribe();
  },

  /**
   * Delete message for self
   */
  async deleteForMe(messageId: string, userId: string): Promise<{ success: boolean }> {
    const { data: message } = await supabase
      .from('messages')
      .select('deleted_for')
      .eq('id', messageId)
      .single();

    const deletedFor = message?.deleted_for || [];
    if (!deletedFor.includes(userId)) {
      deletedFor.push(userId);
    }

    const { error } = await supabase
      .from('messages')
      .update({ deleted_for: deletedFor })
      .eq('id', messageId);

    return { success: !error };
  },

  /**
   * Delete message for everyone (sender only)
   */
  async deleteForEveryone(
    messageId: string,
    senderId: string
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
      .from('messages')
      .update({ is_deleted: true, content: 'This message was deleted' })
      .eq('id', messageId)
      .eq('sender_id', senderId);

    if (error) {
      return { success: false, error: 'You can only delete your own messages' };
    }

    return { success: true };
  },

  /**
   * Add reaction to message
   */
  async addReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const { data: message } = await supabase
      .from('messages')
      .select('reactions')
      .eq('id', messageId)
      .single();

    const reactions = message?.reactions || {};
    if (!reactions[emoji]) {
      reactions[emoji] = [];
    }

    if (!reactions[emoji].includes(userId)) {
      reactions[emoji].push(userId);
    }

    await supabase
      .from('messages')
      .update({ reactions })
      .eq('id', messageId);
  },

  /**
   * Remove reaction from message
   */
  async removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const { data: message } = await supabase
      .from('messages')
      .select('reactions')
      .eq('id', messageId)
      .single();

    const reactions = message?.reactions || {};
    if (reactions[emoji]) {
      reactions[emoji] = reactions[emoji].filter((id: string) => id !== userId);
      if (reactions[emoji].length === 0) {
        delete reactions[emoji];
      }
    }

    await supabase
      .from('messages')
      .update({ reactions })
      .eq('id', messageId);
  },

  /**
   * Get chat list with last messages - OPTIMIZED: Single SQL query via RPC
   * Replaces 2N queries with 1 single database call
   */
  async getChatList(userId: string, friendIds: string[]): Promise<Contact[]> {
    if (friendIds.length === 0) return [];

    // Use optimized RPC function - 1 query instead of 2N queries
    const { data, error } = await supabase.rpc('get_chat_list_optimized', {
      p_user_id: userId,
      p_friend_ids: friendIds
    });

    if (error) {
      console.error('Error fetching chat list:', error);
      // Fallback to old method if RPC fails
      return this.getChatListFallback(userId, friendIds);
    }

    if (!data || data.length === 0) return [];

    // Transform RPC result to Contact[] format
    const chats: Contact[] = data.map((row: any) => {
      const profile: UserProfile = {
        id: row.user_id,
        email: '',
        full_name: row.full_name || '',
        username: row.username,
        avatar_url: row.avatar_url,
        bio: row.bio,
        is_online: row.is_online,
        last_seen: row.last_seen
      };

      const lastMessage: Message | undefined = row.last_message_id ? {
        id: row.last_message_id,
        sender_id: row.last_message_sender_id,
        receiver_id: row.last_message_sender_id === userId ? row.user_id : userId,
        content: row.last_message_content || '',
        type: (row.last_message_type || 'text') as Message['type'],
        created_at: row.last_message_created_at,
        is_read: row.last_message_is_read
      } : undefined;

      return {
        user_id: row.user_id,
        status: 'accepted' as const,
        profile,
        lastMessage,
        unreadCount: Number(row.unread_count) || 0
      };
    });

    // Cache profiles for offline access
    const profiles = chats.map(c => c.profile);
    cacheProfiles(profiles).catch(() => {});

    // Already sorted by last_message_created_at DESC from SQL
    return chats;
  },

  /**
   * Fallback method if RPC function is not available
   */
  async getChatListFallback(userId: string, friendIds: string[]): Promise<Contact[]> {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('id', friendIds);

    if (!profiles) return [];

    await cacheProfiles(profiles as UserProfile[]);

    const messagePromises = profiles.map(async (profile) => {
      const [lastMessageResult, unreadCountResult] = await Promise.all([
        supabase
          .from('messages')
          .select('*')
          .or(
            `and(sender_id.eq.${userId},receiver_id.eq.${profile.id}),and(sender_id.eq.${profile.id},receiver_id.eq.${userId})`
          )
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

        supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('sender_id', profile.id)
          .eq('receiver_id', userId)
          .eq('is_read', false)
      ]);

      return {
        user_id: profile.id,
        status: 'accepted' as const,
        profile: profile as UserProfile,
        lastMessage: lastMessageResult.data as Message | undefined,
        unreadCount: unreadCountResult.count || 0
      };
    });

    const results = await Promise.all(messagePromises);

    return results.sort((a, b) => {
      const aTime = a.lastMessage?.created_at || '0';
      const bTime = b.lastMessage?.created_at || '0';
      return bTime.localeCompare(aTime);
    });
  },

  /**
   * Subscribe to messages realtime
   */
  subscribeToMessages(
    userId: string,
    onNewMessage: (message: Message) => void,
    onUpdate: (message: Message) => void
  ) {
    return supabase
      .channel('messages_' + userId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const msg = payload.new as Message;
          if (msg.sender_id === userId || msg.receiver_id === userId) {
            const existingLocal = msg.client_message_id
              ? await getMessageByClientId(msg.client_message_id)
              : null;

            if (existingLocal && existingLocal.syncStatus === 'pending') {
              await updateMessageSyncStatus(
                existingLocal.id,
                'sent',
                msg.id,
                msg.created_at
              );
            }

            onNewMessage(msg);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as Message;
          if (msg.sender_id === userId || msg.receiver_id === userId) {
            onUpdate(msg);
          }
        }
      )
      .subscribe();
  },

  /**
   * Subscribe to read receipts (for sender to know when their messages are read)
   */
  subscribeToReadReceipts(
    userId: string,
    onMessagesRead: (messageIds: string[]) => void
  ) {
    return supabase
      .channel(`read_receipts_${userId}`)
      .on(
        'broadcast',
        { event: 'messages_read' },
        (payload: { payload: { reader_id: string; message_ids: string[] } }) => {
          if (payload.payload && payload.payload.message_ids) {
            onMessagesRead(payload.payload.message_ids);
          }
        }
      )
      .subscribe();
  },

  /**
   * Edit a sent message (only text messages, only by sender)
   */
  async editMessage(
    messageId: string,
    senderId: string,
    newContent: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // First verify the message belongs to the sender
      const { data: existingMessage, error: fetchError } = await supabase
        .from('messages')
        .select('sender_id, type, created_at')
        .eq('id', messageId)
        .single();

      if (fetchError || !existingMessage) {
        return { success: false, error: 'Message not found' };
      }

      if (existingMessage.sender_id !== senderId) {
        return { success: false, error: 'You can only edit your own messages' };
      }

      if (existingMessage.type !== 'text') {
        return { success: false, error: 'Only text messages can be edited' };
      }

      // Check if message is too old (optional: 15 minutes limit like WhatsApp)
      const messageTime = new Date(existingMessage.created_at).getTime();
      const now = Date.now();
      const fifteenMinutes = 15 * 60 * 1000;

      if (now - messageTime > fifteenMinutes) {
        return { success: false, error: 'Messages can only be edited within 15 minutes' };
      }

      // Update the message
      const { error: updateError } = await supabase
        .from('messages')
        .update({
          content: newContent,
          is_edited: true,
          edited_at: new Date().toISOString()
        })
        .eq('id', messageId)
        .eq('sender_id', senderId);

      if (updateError) {
        log.error('Failed to edit message', updateError, 'chatService');
        return { success: false, error: updateError.message };
      }

      return { success: true };
    } catch (error: any) {
      log.error('Edit message failed', error, 'chatService');
      return { success: false, error: error.message || 'Failed to edit message' };
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

        // Prepare forwarded message content
        const forwardedContent = originalMessage.type === 'text'
          ? originalMessage.content
          : originalMessage.content; // For media, content contains the URL

        const { error } = await supabase
          .from('messages')
          .insert({
            sender_id: senderId,
            receiver_id: receiverId,
            content: forwardedContent,
            type: originalMessage.type,
            media_url: originalMessage.media_url,
            thumbnail_url: originalMessage.thumbnail_url,
            file_name: originalMessage.fileName,
            file_size: originalMessage.fileSize,
            duration: originalMessage.duration,
            client_message_id: clientMessageId,
            is_read: false,
            is_deleted: false
          });

        if (!error) {
          sentCount++;
        } else {
          log.error('Failed to forward message', error, 'chatService');
        }
      }

      return { success: sentCount > 0, sentCount };
    } catch (error: any) {
      log.error('Forward to users failed', error, 'chatService');
      return { success: false, sentCount, error: error.message };
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

        const forwardedContent = originalMessage.type === 'text'
          ? originalMessage.content
          : originalMessage.content;

        const { error } = await supabase
          .from('group_messages')
          .insert({
            group_id: groupId,
            sender_id: senderId,
            content: forwardedContent,
            type: originalMessage.type,
            media_url: originalMessage.media_url,
            thumbnail_url: originalMessage.thumbnail_url,
            file_name: originalMessage.fileName,
            file_size: originalMessage.fileSize,
            duration: originalMessage.duration,
            client_message_id: clientMessageId,
            is_deleted: false
          });

        if (!error) {
          sentCount++;
        } else {
          log.error('Failed to forward message to group', error, 'chatService');
        }
      }

      return { success: sentCount > 0, sentCount };
    } catch (error: any) {
      log.error('Forward to groups failed', error, 'chatService');
      return { success: false, sentCount, error: error.message };
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
              const { data: serverMessages } = await supabase
                .from('messages')
                .select('*')
                .or(
                  `and(sender_id.eq.${userId},receiver_id.eq.${contactId}),and(sender_id.eq.${contactId},receiver_id.eq.${userId})`
                )
                .order('created_at', { ascending: false })
                .limit(limit);

              if (serverMessages && serverMessages.length > 0) {
                const messages = serverMessages.reverse() as Message[];
                messageCache.set(chatId, {
                  messages,
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
