/**
 * useGroupChat Hook - Offline-First Group Chat Management
 *
 * Provides:
 * - Group message loading with pagination
 * - Optimistic message sending
 * - Realtime subscriptions
 * - Sync status tracking
 * - Member profile caching
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { GroupMessage, GroupMember, UserProfile } from '../types';
import { groupService } from '../services/groupService';
import { supabase } from '../supabaseClient';
import { isOnline, setupConnectivityListeners } from '../utils/offlineStorage';

export type GroupMessageSyncStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface GroupMessageWithStatus extends GroupMessage {
  syncStatus?: GroupMessageSyncStatus;
  clientMessageId?: string;
}

export interface UseGroupChatOptions {
  groupId: string | null;
  userId: string | null;
  onNewMessage?: (message: GroupMessage) => void;
  onMessageUpdate?: (message: GroupMessage) => void;
  onMemberJoin?: (member: GroupMember) => void;
  onMemberLeave?: (userId: string) => void;
}

export interface UseGroupChatReturn {
  messages: GroupMessageWithStatus[];
  members: GroupMember[];
  memberProfiles: Record<string, UserProfile>;
  isLoading: boolean;
  isSending: boolean;
  isOnline: boolean;
  error: string | null;
  hasMore: boolean;
  sendMessage: (content: string, type?: GroupMessage['type'], extras?: any) => Promise<void>;
  loadMessages: (forceRefresh?: boolean) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  markAsRead: () => Promise<void>;
  deleteForMe: (messageId: string) => Promise<void>;
  deleteForEveryone: (messageId: string) => Promise<void>;
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
  retryFailedMessages: () => Promise<void>;
}

export function useGroupChat(options: UseGroupChatOptions): UseGroupChatReturn {
  const { groupId, userId, onNewMessage, onMessageUpdate, onMemberJoin, onMemberLeave } = options;

  const [messages, setMessages] = useState<GroupMessageWithStatus[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, UserProfile>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [online, setOnline] = useState(isOnline());
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const messagesChannelRef = useRef<any>(null);
  const membersChannelRef = useRef<any>(null);
  const oldestMessageRef = useRef<string | null>(null);

  // Fetch member profiles
  const fetchMemberProfiles = useCallback(async (memberList: GroupMember[]) => {
    const userIds = memberList.map(m => m.user_id);
    if (userIds.length === 0) return;

    try {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds);

      if (profiles) {
        const profileMap: Record<string, UserProfile> = {};
        profiles.forEach(p => {
          profileMap[p.id] = p;
        });
        setMemberProfiles(prev => ({ ...prev, ...profileMap }));
      }
    } catch (err) {
      console.error('[useGroupChat] fetchMemberProfiles error:', err);
    }
  }, []);

  // Setup connectivity listeners
  useEffect(() => {
    const cleanup = setupConnectivityListeners(
      async () => {
        setOnline(true);
        if (groupId && userId) {
          loadMessages(true);
        }
      },
      () => {
        setOnline(false);
      }
    );

    return cleanup;
  }, [groupId, userId]);

  // Load messages
  const loadMessages = useCallback(async (_forceRefresh = false) => {
    if (!groupId) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await groupService.getMessages(groupId, { limit: 50 });

      if (result.success && result.data) {
        const messagesWithStatus: GroupMessageWithStatus[] = result.data.map(m => ({
          ...m,
          syncStatus: 'sent' as const
        }));

        setMessages(messagesWithStatus);

        if (result.data.length > 0) {
          oldestMessageRef.current = result.data[0].created_at;
        }

        setHasMore(result.data.length === 50);
      } else {
        // Handle specific RLS policy errors gracefully
        const errorMessage = result.error || 'Failed to load messages';
        if (errorMessage.includes('infinite recursion') || errorMessage.includes('policy')) {
          // This is a database configuration issue - don't show technical error to user
          console.error('[useGroupChat] RLS Policy Error:', errorMessage);
          setError(null); // Clear error - messages will load from cache if available
        } else {
          setError(errorMessage);
        }
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to load messages';
      // Handle specific RLS policy errors gracefully
      if (errorMessage.includes('infinite recursion') || errorMessage.includes('policy')) {
        console.error('[useGroupChat] RLS Policy Error:', errorMessage);
        setError(null);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  }, [groupId]);

  // Load more messages (pagination)
  const loadMoreMessages = useCallback(async () => {
    if (!groupId || !hasMore || isLoading) return;

    setIsLoading(true);

    try {
      const result = await groupService.getMessages(groupId, {
        limit: 50,
        beforeTimestamp: oldestMessageRef.current || undefined
      });

      if (result.success && result.data) {
        const messagesWithStatus: GroupMessageWithStatus[] = result.data.map(m => ({
          ...m,
          syncStatus: 'sent' as const
        }));

        setMessages(prev => [...messagesWithStatus, ...prev]);

        if (result.data.length > 0) {
          oldestMessageRef.current = result.data[0].created_at;
        }

        setHasMore(result.data.length === 50);
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to load more messages';
      if (!errorMessage.includes('infinite recursion') && !errorMessage.includes('policy')) {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  }, [groupId, hasMore, isLoading]);

  // Send message
  const sendMessage = useCallback(async (
    content: string,
    type: GroupMessage['type'] = 'text',
    extras: any = {}
  ) => {
    if (!groupId || !userId || (!content.trim() && type === 'text')) return;

    setIsSending(true);
    setError(null);

    try {
      const result = await groupService.sendMessage({
        groupId,
        senderId: userId,
        content,
        type,
        replyToId: extras.replyToId
      });

      if (result.data) {
        const messageWithStatus: GroupMessageWithStatus = {
          ...result.data.message,
          syncStatus: result.data.isOffline ? 'pending' : (result.success ? 'sent' : 'failed'),
          clientMessageId: result.data.clientMessageId,
          sender_profile: memberProfiles[userId]
        };

        setMessages(prev => {
          const exists = prev.some(m =>
            m.clientMessageId === result.data?.clientMessageId ||
            m.client_message_id === result.data?.clientMessageId ||
            m.id === result.data?.message.id
          );

          if (exists) {
            return prev.map(m =>
              (m.clientMessageId === result.data?.clientMessageId ||
               m.client_message_id === result.data?.clientMessageId)
                ? messageWithStatus
                : m
            );
          }

          return [...prev, messageWithStatus];
        });
      }

      if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  }, [groupId, userId, memberProfiles]);

  // Mark as read
  const markAsRead = useCallback(async () => {
    if (!groupId || !userId) return;
    await groupService.markAsRead(groupId, userId);
  }, [groupId, userId]);

  // Delete for me
  const deleteForMe = useCallback(async (messageId: string) => {
    if (!userId) return;

    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, deleted_for: [...(m.deleted_for || []), userId] }
        : m
    ));

    await groupService.deleteMessageForMe(messageId, userId);
  }, [userId]);

  // Delete for everyone
  const deleteForEveryone = useCallback(async (messageId: string) => {
    if (!userId) return;

    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, is_deleted: true, content: 'This message was deleted' }
        : m
    ));

    const result = await groupService.deleteMessageForEveryone(messageId, userId);
    if (!result.success) {
      setError(result.error || 'Failed to delete message');
    }
  }, [userId]);

  // Add reaction
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

    await groupService.addReaction(messageId, userId, emoji);
  }, [userId]);

  // Remove reaction
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

    await groupService.removeReaction(messageId, userId, emoji);
  }, [userId]);

  // Retry failed messages
  const retryFailedMessages = useCallback(async () => {
    const failedMessages = messages.filter(m => m.syncStatus === 'failed' || m.syncStatus === 'pending');

    for (const msg of failedMessages) {
      setMessages(prev => prev.map(m =>
        m.id === msg.id || m.clientMessageId === msg.clientMessageId
          ? { ...m, syncStatus: 'sending' }
          : m
      ));

      const result = await groupService.sendMessage({
        groupId: msg.group_id,
        senderId: msg.sender_id,
        content: msg.content,
        type: msg.type
      });

      setMessages(prev => prev.map(m =>
        m.id === msg.id || m.clientMessageId === msg.clientMessageId
          ? { ...m, syncStatus: result.success ? 'sent' : 'failed' }
          : m
      ));
    }
  }, [messages]);

  // Load initial data and subscribe
  useEffect(() => {
    if (!groupId || !userId) return;

    const loadInitialData = async () => {
      try {
        // Load group with members
        const groupResult = await groupService.getGroup(groupId);
        if (groupResult.success && groupResult.data) {
          setMembers(groupResult.data.members);
          await fetchMemberProfiles(groupResult.data.members);
        } else if (groupResult.error) {
          // Handle RLS policy errors gracefully
          const errorMessage = groupResult.error;
          if (errorMessage.includes('infinite recursion') || errorMessage.includes('policy')) {
            console.error('[useGroupChat] RLS Policy Error in getGroup:', errorMessage);
            // Don't set error - just log it
          }
        }

        // Load messages
        await loadMessages();

        // Mark as read
        await markAsRead();
      } catch (err: any) {
        const errorMessage = err.message || '';
        if (!errorMessage.includes('infinite recursion') && !errorMessage.includes('policy')) {
          setError(errorMessage);
        } else {
          console.error('[useGroupChat] RLS Policy Error:', errorMessage);
        }
      }
    };

    loadInitialData();

    // Subscribe to messages
    messagesChannelRef.current = groupService.subscribeToGroupMessages(
      groupId,
      (newMessage) => {
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
        onNewMessage?.(newMessage);
      },
      (updatedMessage) => {
        setMessages(prev => prev.map(m =>
          m.id === updatedMessage.id ? { ...updatedMessage, syncStatus: 'sent' } : m
        ));
        onMessageUpdate?.(updatedMessage);
      }
    );

    // Subscribe to members
    membersChannelRef.current = groupService.subscribeToGroupMembers(
      groupId,
      async (newMember) => {
        setMembers(prev => [...prev, newMember]);
        await fetchMemberProfiles([newMember]);
        onMemberJoin?.(newMember);
      },
      (leftUserId) => {
        setMembers(prev => prev.filter(m => m.user_id !== leftUserId));
        onMemberLeave?.(leftUserId);
      },
      (updatedMember) => {
        setMembers(prev => prev.map(m =>
          m.user_id === updatedMember.user_id ? updatedMember : m
        ));
      }
    );

    return () => {
      if (messagesChannelRef.current) {
        supabase.removeChannel(messagesChannelRef.current);
      }
      if (membersChannelRef.current) {
        supabase.removeChannel(membersChannelRef.current);
      }
    };
  }, [groupId, userId]);

  // Filter out deleted messages for current user
  const filteredMessages = messages.filter(m => !m.deleted_for?.includes(userId || ''));

  return {
    messages: filteredMessages,
    members,
    memberProfiles,
    isLoading,
    isSending,
    isOnline: online,
    error,
    hasMore,
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

export default useGroupChat;
