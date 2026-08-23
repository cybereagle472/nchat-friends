/**
 * useChat Hook - Offline-First Chat Management
 *
 * This hook provides a drop-in replacement for chat functionality
 * with offline-first support, sync status tracking, and optimistic updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Message } from '../types';
import { chatService } from '../services/chatService';
import { supabase } from '../supabaseClient';
import {
  isOnline,
  setupConnectivityListeners,
  getPendingMessages
} from '../utils/offlineStorage';

export interface MessageWithStatus extends Message {
  syncStatus?: 'pending' | 'sending' | 'sent' | 'failed';
  clientMessageId?: string;
}

export interface UseChatOptions {
  userId: string | null;
  contactId: string | null;
  onNewMessage?: (message: Message) => void;
  onMessageUpdate?: (message: Message) => void;
  onSyncStatusChange?: (isOnline: boolean, pendingCount: number) => void;
}

export interface UseChatReturn {
  messages: MessageWithStatus[];
  isLoading: boolean;
  isSending: boolean;
  isOnline: boolean;
  pendingCount: number;
  error: string | null;
  sendMessage: (content: string, type?: Message['type'], extras?: any) => Promise<void>;
  loadMessages: (forceRefresh?: boolean) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  markAsRead: () => Promise<void>;
  deleteForMe: (messageId: string) => Promise<void>;
  deleteForEveryone: (messageId: string) => Promise<void>;
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
  retryFailedMessages: () => Promise<{ processed: number; failed: number }>;
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const { userId, contactId, onNewMessage, onMessageUpdate, onSyncStatusChange } = options;

  const [messages, setMessages] = useState<MessageWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [online, setOnline] = useState(isOnline());
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const subscriptionRef = useRef<any>(null);
  const oldestMessageRef = useRef<string | null>(null);

  const updatePendingCount = useCallback(async () => {
    const pending = await getPendingMessages();
    setPendingCount(pending.length);
    onSyncStatusChange?.(online, pending.length);
  }, [online, onSyncStatusChange]);

  useEffect(() => {
    const cleanup = setupConnectivityListeners(
      async () => {
        setOnline(true);
        await chatService.processPendingQueue((clientId, status) => {
          setMessages(prev => prev.map(m =>
            m.clientMessageId === clientId
              ? { ...m, syncStatus: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'sending' }
              : m
          ));
        });
        await updatePendingCount();
        if (userId && contactId) {
          loadMessages(true);
        }
      },
      () => {
        setOnline(false);
        onSyncStatusChange?.(false, pendingCount);
      }
    );

    return cleanup;
  }, [userId, contactId, pendingCount, updatePendingCount, onSyncStatusChange]);

  const loadMessages = useCallback(async (forceRefresh = false) => {
    if (!userId || !contactId) return;

    setIsLoading(true);
    setError(null);

    try {
      const fetchedMessages = await chatService.getMessages(userId, contactId, {
        limit: 50,
        forceServerSync: forceRefresh
      });

      const messagesWithStatus: MessageWithStatus[] = fetchedMessages.map(m => ({
        ...m,
        syncStatus: 'sent' as const
      }));

      setMessages(messagesWithStatus);

      if (fetchedMessages.length > 0) {
        oldestMessageRef.current = fetchedMessages[0].created_at;
      }

      setHasMore(fetchedMessages.length === 50);
    } catch (err: any) {
      setError(err.message || 'Failed to load messages');
    } finally {
      setIsLoading(false);
    }
  }, [userId, contactId]);

  const loadMoreMessages = useCallback(async () => {
    if (!userId || !contactId || !hasMore || isLoading) return;

    setIsLoading(true);

    try {
      const olderMessages = await chatService.getMessages(userId, contactId, {
        limit: 50,
        beforeTimestamp: oldestMessageRef.current || undefined
      });

      if (olderMessages.length > 0) {
        const messagesWithStatus: MessageWithStatus[] = olderMessages.map(m => ({
          ...m,
          syncStatus: 'sent' as const
        }));

        setMessages(prev => [...messagesWithStatus, ...prev]);
        oldestMessageRef.current = olderMessages[0].created_at;
      }

      setHasMore(olderMessages.length === 50);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [userId, contactId, hasMore, isLoading]);

  const sendMessage = useCallback(async (
    content: string,
    type: Message['type'] = 'text',
    extras: any = {}
  ) => {
    if (!userId || !contactId || (!content.trim() && type === 'text')) return;

    setIsSending(true);
    setError(null);

    try {
      const result = await chatService.sendMessage({
        senderId: userId,
        receiverId: contactId,
        content,
        type,
        duration: extras.duration,
        replyToId: extras.replyToId
      });

      if (result.message) {
        const messageWithStatus: MessageWithStatus = {
          ...result.message,
          syncStatus: result.isOffline ? 'pending' : (result.success ? 'sent' : 'failed'),
          clientMessageId: result.clientMessageId,
          ...extras
        };

        setMessages(prev => {
          const exists = prev.some(m =>
            m.clientMessageId === result.clientMessageId || m.id === result.message?.id
          );
          if (exists) {
            return prev.map(m =>
              m.clientMessageId === result.clientMessageId ? messageWithStatus : m
            );
          }
          return [...prev, messageWithStatus];
        });

        if (result.isOffline) {
          await updatePendingCount();
        }
      }

      if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  }, [userId, contactId, updatePendingCount]);

  const markAsRead = useCallback(async () => {
    if (!userId || !contactId) return;
    await chatService.markAsRead(userId, contactId);
  }, [userId, contactId]);

  const deleteForMe = useCallback(async (messageId: string) => {
    if (!userId) return;

    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, deleted_for: [...(m.deleted_for || []), userId] }
        : m
    ));

    await chatService.deleteForMe(messageId, userId);
  }, [userId]);

  const deleteForEveryone = useCallback(async (messageId: string) => {
    if (!userId) return;

    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, is_deleted: true, content: 'This message was deleted' }
        : m
    ));

    const result = await chatService.deleteForEveryone(messageId, userId);
    if (!result.success) {
      setError(result.error || 'Failed to delete message');
    }
  }, [userId]);

  const addReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!userId) return;

    setMessages(prev => prev.map(m => {
      if (m.id === messageId) {
        const reactions = { ...(m.reactions || {}) };
        if (!reactions[emoji]) reactions[emoji] = [];
        if (!reactions[emoji].includes(userId)) {
          reactions[emoji] = [...reactions[emoji], userId];
        }
        return { ...m, reactions };
      }
      return m;
    }));

    await chatService.addReaction(messageId, userId, emoji);
  }, [userId]);

  const removeReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!userId) return;

    setMessages(prev => prev.map(m => {
      if (m.id === messageId) {
        const reactions = { ...(m.reactions || {}) };
        if (reactions[emoji]) {
          reactions[emoji] = reactions[emoji].filter(id => id !== userId);
          if (reactions[emoji].length === 0) delete reactions[emoji];
        }
        return { ...m, reactions };
      }
      return m;
    }));

    await chatService.removeReaction(messageId, userId, emoji);
  }, [userId]);

  const retryFailedMessages = useCallback(async () => {
    const result = await chatService.processPendingQueue((clientId, status) => {
      setMessages(prev => prev.map(m =>
        m.clientMessageId === clientId
          ? { ...m, syncStatus: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'sending' }
          : m
      ));
    });
    await updatePendingCount();
    return result;
  }, [updatePendingCount]);

  useEffect(() => {
    if (!userId) return;

    subscriptionRef.current = chatService.subscribeToMessages(
      userId,
      (newMessage) => {
        if (contactId && (newMessage.sender_id === contactId || newMessage.receiver_id === contactId)) {
          setMessages(prev => {
            const existingIndex = prev.findIndex(m =>
              m.client_message_id === newMessage.client_message_id ||
              m.clientMessageId === newMessage.client_message_id
            );

            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = { ...newMessage, syncStatus: 'sent' };
              return updated;
            }

            const exists = prev.some(m => m.id === newMessage.id);
            if (!exists) {
              return [...prev, { ...newMessage, syncStatus: 'sent' }];
            }
            return prev;
          });
        }
        onNewMessage?.(newMessage);
      },
      (updatedMessage) => {
        setMessages(prev => prev.map(m =>
          m.id === updatedMessage.id ? { ...updatedMessage, syncStatus: 'sent' } : m
        ));
        onMessageUpdate?.(updatedMessage);
      }
    );

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
      }
    };
  }, [userId, contactId, onNewMessage, onMessageUpdate]);

  useEffect(() => {
    if (userId && contactId) {
      loadMessages();
      markAsRead();
    }
  }, [userId, contactId]);

  useEffect(() => {
    updatePendingCount();
  }, [updatePendingCount]);

  const filteredMessages = messages.filter(m => !m.deleted_for?.includes(userId || ''));

  return {
    messages: filteredMessages,
    isLoading,
    isSending,
    isOnline: online,
    pendingCount,
    error,
    sendMessage,
    loadMessages,
    loadMoreMessages,
    markAsRead,
    deleteForMe,
    deleteForEveryone,
    addReaction,
    removeReaction,
    retryFailedMessages
  };
}

export default useChat;
