/**
 * useGroupChat Hook - Group Chat Management (Cloudflare Worker backend)
 *
 * Provides:
 * - Group message loading with pagination
 * - Optimistic message sending
 * - Realtime subscriptions (single shared per-user WebSocket, see groupService)
 * - Sync status tracking
 * - Member profiles (sourced straight from groupService.getGroup(), which
 *   already joins each member's profile server-side — no separate lookup)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { GroupMessage, GroupMember, UserProfile } from '../types';
import { groupService, GroupSubscription } from '../services/groupService';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const messagesSubRef = useRef<GroupSubscription | null>(null);
  const membersSubRef = useRef<GroupSubscription | null>(null);
  const readReceiptSubRef = useRef<GroupSubscription | null>(null);
  const oldestMessageRef = useRef<string | null>(null);

  // Per-member "read up to" timestamps (ISO strings), used to derive the
  // double-check "read by everyone" tick on messages *I* sent. Seeded from
  // each member's last_read_at (groupWithMembers() on the Worker) and kept
  // live by subscribeToGroupReadReceipts below — no refetch needed when
  // someone reads the chat while it's open.
  const [readStates, setReadStates] = useState<Record<string, string>>({});

  const applyMembers = useCallback((memberList: GroupMember[]) => {
    setMembers(memberList);
    const profileMap: Record<string, UserProfile> = {};
    const readMap: Record<string, string> = {};
    memberList.forEach((m) => {
      if (m.profile) profileMap[m.user_id] = m.profile;
      if (m.last_read_at) readMap[m.user_id] = m.last_read_at;
    });
    setMemberProfiles((prev) => ({ ...prev, ...profileMap }));
    setReadStates((prev) => ({ ...prev, ...readMap }));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load messages');
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
      setError(err.message || 'Failed to load more messages');
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
        replyToId: extras.replyToId,
        duration: extras.duration,
        waveform: extras.waveform
      });

      if (result.data) {
        const messageWithStatus: GroupMessageWithStatus = {
          ...result.data.message,
          syncStatus: result.data.isOffline ? 'failed' : 'sent',
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
        type: msg.type,
        clientMessageId: msg.clientMessageId || msg.client_message_id
      });

      setMessages(prev => prev.map(m =>
        m.id === msg.id || m.clientMessageId === msg.clientMessageId
          ? { ...m, syncStatus: result.success ? 'sent' : 'failed' }
          : m
      ));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Load initial data and subscribe
  useEffect(() => {
    if (!groupId || !userId) return;

    const loadInitialData = async () => {
      try {
        const groupResult = await groupService.getGroup(groupId);
        if (groupResult.success && groupResult.data) {
          applyMembers(groupResult.data.members);
        } else if (groupResult.error) {
          setError(groupResult.error);
        }

        await loadMessages();
        await markAsRead();
      } catch (err: any) {
        setError(err.message || 'Failed to load group');
      }
    };

    loadInitialData();

    messagesSubRef.current = groupService.subscribeToGroupMessages(
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

        // Keep advancing my read high-water-mark while the chat stays
        // open, same as ChatView does for 1:1 — otherwise my last_read_at
        // would freeze at "whenever I opened this screen" and every
        // message that arrives afterwards would still count as unread the
        // moment I leave, even though I was looking right at it.
        if (newMessage.sender_id !== userId) {
          markAsRead();
        }
      },
      (updatedMessage) => {
        setMessages(prev => prev.map(m =>
          m.id === updatedMessage.id ? { ...m, ...updatedMessage, syncStatus: 'sent' } : m
        ));
        onMessageUpdate?.(updatedMessage);
      },
      (deletedMessageId) => {
        setMessages(prev => prev.map(m =>
          m.id === deletedMessageId ? { ...m, is_deleted: true, content: 'This message was deleted' } : m
        ));
      }
    );

    readReceiptSubRef.current = groupService.subscribeToGroupReadReceipts(
      groupId,
      (readerId, readAt) => {
        setReadStates(prev => ({ ...prev, [readerId]: readAt }));
      }
    );

    membersSubRef.current = groupService.subscribeToGroupMembers(
      groupId,
      (newMember) => {
        setMembers(prev => (prev.some(m => m.user_id === newMember.user_id) ? prev : [...prev, newMember]));
        if (newMember.profile) setMemberProfiles(prev => ({ ...prev, [newMember.user_id]: newMember.profile! }));
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
      messagesSubRef.current?.unsubscribe();
      membersSubRef.current?.unsubscribe();
      readReceiptSubRef.current?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, userId]);

  // Filter out deleted messages for current user, and derive the
  // double-check "read by everyone" tick on my own sent messages from the
  // live readStates map — a message is read once every *other* current
  // member's last known read timestamp is at or after it was sent. (Other
  // members' own incoming messages don't carry a meaningful is_read here;
  // the UI only ever renders this for the current user's own bubbles.)
  const otherMemberIds = members.filter(m => m.user_id !== userId).map(m => m.user_id);
  const filteredMessages = messages
    .filter(m => !m.deleted_for?.includes(userId || ''))
    .map(m => {
      if (m.sender_id !== userId) return m;
      const isRead = otherMemberIds.length > 0 && otherMemberIds.every(id => {
        const readAt = readStates[id];
        return !!readAt && readAt >= m.created_at;
      });
      return isRead === m.is_read ? m : { ...m, is_read: isRead };
    });

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
