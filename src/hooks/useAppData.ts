/**
 * Global App Data Hook - WhatsApp-style instant loading
 *
 * Features:
 * - localStorage instant cache (0ms display on app start)
 * - In-memory global cache (instant tab switching)
 * - Background sync (keeps data fresh)
 * - Debounced subscription updates (smooth UI)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { chatService } from '../services/chatService';
import { friendService } from '../services/friendService';
import { groupService, GroupWithMembers } from '../services/groupService';
import { callService } from '../services/callService';
import { profileService } from '../services/profileService';
import { Contact, UserProfile, FriendRequest, CallHistory, Message } from '../types';
import { realtimeClient } from '../lib/realtimeClient';

// ============================================
// INSTANT CACHE UTILITIES
// ============================================

const INSTANT_CACHE_KEY = 'nchat_instant_cache';
const INSTANT_CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface InstantCacheData {
  version: number;
  timestamp: number;
  userId: string;
  chats: Contact[];
  friends: { id: string; profile: UserProfile }[];
  groups: GroupWithMembers[];
}

// Get instant cache SYNCHRONOUSLY (0ms) - called before any async operation
function getInstantCache(userId: string): Partial<AppData> | null {
  try {
    const raw = localStorage.getItem(INSTANT_CACHE_KEY);
    if (!raw) return null;

    const cache: InstantCacheData = JSON.parse(raw);

    // Validate cache
    if (cache.version !== INSTANT_CACHE_VERSION) return null;
    if (cache.userId !== userId) return null;
    if (Date.now() - cache.timestamp > CACHE_MAX_AGE_MS) return null;

    // Reconstruct Set for sentRequestIds (can't be stored in JSON)
    return {
      chats: cache.chats || [],
      friends: cache.friends || [],
      groups: cache.groups || [],
      isReady: true // Show cached data immediately
    };
  } catch {
    return null;
  }
}

// Save instant cache (debounced, non-blocking)
let saveTimeout: NodeJS.Timeout | null = null;
function saveInstantCache(userId: string, data: AppData): void {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(() => {
    try {
      const cache: InstantCacheData = {
        version: INSTANT_CACHE_VERSION,
        timestamp: Date.now(),
        userId,
        chats: data.chats,
        friends: data.friends,
        groups: data.groups
      };

      // Trim data to fit in localStorage (5MB limit)
      const jsonStr = JSON.stringify(cache);
      if (jsonStr.length < 4 * 1024 * 1024) { // 4MB safety margin
        localStorage.setItem(INSTANT_CACHE_KEY, jsonStr);
      }
    } catch {
      // Silently fail - cache is optional optimization
    }
  }, 1000); // Save after 1 second of no updates
}

// Debounce utility
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: NodeJS.Timeout;
  return ((...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

export interface Friend {
  id: string;
  profile: UserProfile;
}

export interface Suggestion {
  id: string;
  profile: UserProfile;
  isFriend: boolean;
}

export interface HistoryItem {
  id: string;
  name: string;
  avatar?: string;
  userId: string;
  type: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  timestamp: string;
  duration?: string;
}

interface AppData {
  chats: Contact[];
  friends: Friend[];
  groups: GroupWithMembers[];
  friendRequests: FriendRequest[];
  suggestions: Suggestion[];
  sentRequestIds: Set<string>;
  callHistory: HistoryItem[];
  isReady: boolean;
}

const INITIAL_DATA: AppData = {
  chats: [],
  friends: [],
  groups: [],
  friendRequests: [],
  suggestions: [],
  sentRequestIds: new Set(),
  callHistory: [],
  isReady: false
};

// Global in-memory cache - persists across re-renders
let globalCache: AppData = { ...INITIAL_DATA };

// Run the one-time local-storage repair (see chatService.repairLocalMessageStore)
// at most once per page load, regardless of how many times useAppData mounts.
let localMessageStoreRepaired = false;

/**
 * Merge a freshly-fetched (server-authoritative) chat list with whatever is
 * already in local state, without ever letting the fetch regress a chat the
 * client already knows more about.
 *
 * getChatList() is called from several places (initial load, periodic
 * friends/requests refreshes, pull-to-refresh) that can land at any time,
 * including moments after a live message or read-receipt event already
 * patched `unreadCount`/`lastMessage` in place locally. If that local patch
 * happens to be newer than what this particular fetch captured (a normal
 * race — the fetch was in flight before the live event landed, or the
 * server's own read model hasn't caught up with a write that just
 * happened), blindly replacing the whole list with the fetch's result would
 * snap an already-correct unread badge back to a stale value, making it
 * flicker or disappear for no reason visible to the user.
 */
function mergeChatLists(serverChats: Contact[], localChats: Contact[]): Contact[] {
  if (localChats.length === 0) return serverChats;
  const localByUser = new Map(localChats.map(c => [c.user_id, c]));

  return serverChats.map(serverChat => {
    const local = localByUser.get(serverChat.user_id);
    if (!local) return serverChat;

    const serverTime = serverChat.lastMessage ? new Date(serverChat.lastMessage.created_at).getTime() : 0;
    const localTime = local.lastMessage ? new Date(local.lastMessage.created_at).getTime() : 0;

    if (localTime > serverTime) {
      // Local state has seen a newer message than this fetch did — trust
      // its lastMessage/unreadCount instead of overwriting them.
      return { ...serverChat, lastMessage: local.lastMessage, unreadCount: local.unreadCount };
    }

    if (localTime === serverTime && (local.unreadCount || 0) !== (serverChat.unreadCount || 0)) {
      // Same latest message, but the unread counts disagree (e.g. the
      // client already zeroed it on open while this fetch still reflects
      // the pre-read-receipt count) — prefer whichever is lower, since the
      // only way they'd disagree here is one side already knowing about a
      // read that the other hasn't caught up with yet.
      return { ...serverChat, unreadCount: Math.min(local.unreadCount || 0, serverChat.unreadCount || 0) };
    }

    return serverChat;
  });
}

export function useAppData(userId: string, activeChatUserId?: string | null) {
  // INSTANT: Try localStorage cache first (synchronous, 0ms)
  const [data, setData] = useState<AppData>(() => {
    // First check global memory cache
    if (globalCache.isReady) {
      return globalCache;
    }

    // Then try localStorage instant cache
    const instantCache = getInstantCache(userId);
    if (instantCache) {
      globalCache = { ...globalCache, ...instantCache };
      return globalCache;
    }

    return INITIAL_DATA;
  });

  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const subscriptionsRef = useRef<Array<{ unsubscribe: () => void }>>([]);
  const isLoadingRef = useRef(false);

  // The chat the user currently has open (if any) — used so a live message
  // from that exact contact never spuriously bumps the unread badge for a
  // conversation the user is already looking at.
  const activeChatUserIdRef = useRef<string | null>(activeChatUserId ?? null);
  useEffect(() => {
    activeChatUserIdRef.current = activeChatUserId ?? null;
  }, [activeChatUserId]);

  // Update both state and global cache, and save to localStorage. Accepts
  // either a plain partial object or an updater function (needed for
  // patches that must read the latest `chats` array, e.g. live message
  // events, without racing other state updates).
  const updateData = useCallback((updates: Partial<AppData> | ((prev: AppData) => Partial<AppData>)) => {
    setData(prev => {
      const patch = typeof updates === 'function' ? updates(prev) : updates;
      // Bail out without triggering a re-render if the patch is a no-op
      // (e.g. a live event for a chat that isn't in the list to patch).
      if (!patch || Object.keys(patch).length === 0) return prev;
      const newData = { ...prev, ...patch };
      globalCache = newData;
      // Save to localStorage for instant load next time
      saveInstantCache(userId, newData);
      return newData;
    });
  }, [userId]);

  // Load all data at once - called on app start
  const loadAllData = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    try {
      // Fetch everything in parallel for maximum speed
      const [
        friendsResult,
        groupsResult,
        requestsResult,
        allProfiles,
        callHistoryResult
      ] = await Promise.all([
        friendService.getFriends(userId),
        groupService.getUserGroups(userId),
        friendService.getRequests(userId),
        profileService.getAllProfiles(),
        callService.getCallHistory()
      ]);

      // Process friends
      const friendIds = friendsResult.success && friendsResult.data ? friendsResult.data.friendIds : [];
      const friendProfiles = friendsResult.success && friendsResult.data ? friendsResult.data.friends : [];

      const friends: Friend[] = friendProfiles.map(profile => ({
        id: profile.id,
        profile
      }));

      // Process groups
      const groups = groupsResult.success && groupsResult.data ? groupsResult.data : [];

      // Process friend requests
      const friendRequests = requestsResult.success && requestsResult.data ? requestsResult.data.received : [];
      const sentRequests = requestsResult.success && requestsResult.data ? requestsResult.data.sent : [];
      const sentRequestIds = new Set(sentRequests.map(r => r.receiver_id));

      // Process suggestions (exclude self, friends, sent requests, received requests)
      const requestSenderIds = new Set(friendRequests.map(r => r.sender_id));
      const friendIdSet = new Set(friendIds);

      // Include all users (both friends and non-friends) in suggestions
      const suggestions: Suggestion[] = allProfiles
        .filter(profile =>
          profile.id !== userId &&
          profile.full_name &&
          !requestSenderIds.has(profile.id) // Exclude users who sent us a request (they're in requests tab)
        )
        .map(profile => {
          const isFriend = friendIdSet.has(profile.id);
          return { id: profile.id, profile, isFriend };
        })
        // Sort: friends first, then by name
        .sort((a, b) => {
          if (a.isFriend && !b.isFriend) return -1;
          if (!a.isFriend && b.isFriend) return 1;
          return a.profile.full_name.localeCompare(b.profile.full_name);
        });

      // Process chats (friends with last messages)
      let chats: Contact[] = [];
      if (friendIds.length > 0) {
        chats = await chatService.getChatList(userId, friendIds);
      }

      // Process call history
      const historyItems: HistoryItem[] = [];
      if (callHistoryResult.success && callHistoryResult.data) {
        for (const call of callHistoryResult.data) {
          const isOutgoing = call.caller_id === userId;
          const otherUserId = isOutgoing ? call.callee_id : call.caller_id;

          let profile: UserProfile | null = null;
          if (isOutgoing && call.callee_profile) {
            profile = call.callee_profile;
          } else if (!isOutgoing && call.caller_profile) {
            profile = call.caller_profile;
          } else {
            profile = allProfiles.find(p => p.id === otherUserId) || null;
          }

          let direction: 'incoming' | 'outgoing' | 'missed' = 'outgoing';
          if (!isOutgoing) {
            direction = call.status === 'missed' ? 'missed' : 'incoming';
          } else if (call.status === 'missed') {
            direction = 'missed';
          }

          let durationStr: string | undefined;
          if (call.duration && call.duration > 0) {
            const minutes = Math.floor(call.duration / 60);
            const seconds = call.duration % 60;
            durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          }

          historyItems.push({
            id: call.id,
            name: profile?.full_name || 'Unknown',
            avatar: profile?.avatar_url,
            userId: otherUserId,
            type: call.call_type as 'voice' | 'video',
            direction,
            timestamp: call.started_at,
            duration: durationStr
          });
        }
      }

      updateData(prev => ({
        chats: mergeChatLists(chats, prev.chats),
        friends,
        groups,
        friendRequests,
        suggestions,
        sentRequestIds,
        callHistory: historyItems,
        isReady: true
      }));

    } catch (error) {
      console.error('Error loading app data:', error);
      updateData({ isReady: true }); // Still mark as ready to avoid infinite loading
    } finally {
      isLoadingRef.current = false;
    }
  }, [userId, updateData]);

  // Refresh specific data types
  const refreshChats = useCallback(async () => {
    const friendIds = data.friends.map(f => f.id);
    if (friendIds.length > 0) {
      const chats = await chatService.getChatList(userId, friendIds);
      updateData(prev => ({ chats: mergeChatLists(chats, prev.chats) }));
    }
  }, [userId, data.friends, updateData]);

  // Debounced fallback used only when a live message event can't be applied
  // in place (e.g. a brand-new chat we don't have a Contact entry for yet).
  const refreshChatsRef = useRef(refreshChats);
  useEffect(() => {
    refreshChatsRef.current = refreshChats;
  }, [refreshChats]);
  const fallbackRefreshChats = useMemo(() => debounce(() => refreshChatsRef.current(), 300), []);

  // Patch the Chats list instantly from a live message event — no network
  // round trip, so the list feels exactly as instant as an open
  // conversation. Falls back to a full (debounced) refresh only if the
  // chat isn't in the list yet (e.g. very first message with a new friend).
  const applyIncomingMessage = useCallback((message: Message) => {
    const otherUserId = message.sender_id === userId ? message.receiver_id : message.sender_id;
    const isIncoming = message.receiver_id === userId;
    const isActivelyViewing = isIncoming && activeChatUserIdRef.current === message.sender_id;

    // Keep chatService's per-conversation message cache warm even while that
    // chat is closed. Without this, opening the chat afterwards has to rely
    // on a full server round trip to pick up messages that arrived while it
    // was shut, and would show a stale list for a moment in the meantime.
    // (Idempotent — if ChatView is open for this exact chat it will have
    // already applied the same update itself.)
    chatService.updateCache(userId, otherUserId, message);
    // Also persist it to IndexedDB right away so local storage has it even
    // if the chat never gets opened again before the app is reloaded.
    chatService.persistIncomingMessage(userId, otherUserId, message).catch(() => {});

    updateData((prev) => {
      const idx = prev.chats.findIndex(c => c.user_id === otherUserId);
      if (idx === -1) {
        // Unknown contact yet — fetch the real chat list so the new
        // conversation (with its profile) appears correctly.
        fallbackRefreshChats();
        return {};
      }

      const existing = prev.chats[idx];
      const updatedChat: Contact = {
        ...existing,
        lastMessage: message,
        unreadCount: isActivelyViewing
          ? 0
          : isIncoming
            ? (existing.unreadCount || 0) + 1
            : existing.unreadCount
      };

      // Move the updated chat to the top (most recent conversation first),
      // matching how the server list is already sorted.
      const rest = prev.chats.filter((_, i) => i !== idx);
      return { chats: [updatedChat, ...rest] };
    });
  }, [userId, updateData, fallbackRefreshChats]);

  // Patch an edited/deleted message or a new reaction into the Chats list
  // preview, if it happens to be that chat's last message.
  const applyMessageUpdate = useCallback((updated: Message) => {
    updateData((prev) => {
      const idx = prev.chats.findIndex(c => c.lastMessage?.id === updated.id);
      if (idx === -1) return {};
      const nextChats = [...prev.chats];
      nextChats[idx] = {
        ...nextChats[idx],
        lastMessage: { ...(nextChats[idx].lastMessage as Message), ...updated }
      };
      return { chats: nextChats };
    });
  }, [updateData]);

  // Patch the "seen" tick instantly when the other person reads messages we
  // sent them — this is what makes delivery status visible outside an open
  // chat (previously nothing ever told the Chats list about read receipts).
  const applyReadReceipt = useCallback((readerId: string, messageIds: string[]) => {
    updateData((prev) => {
      const idx = prev.chats.findIndex(c => c.user_id === readerId);
      if (idx === -1) return {};
      const chat = prev.chats[idx];
      if (!chat.lastMessage || !messageIds.includes(chat.lastMessage.id)) return {};
      const nextChats = [...prev.chats];
      nextChats[idx] = { ...chat, lastMessage: { ...chat.lastMessage, is_read: true } };
      return { chats: nextChats };
    });
  }, [updateData]);

  // Instantly zero a chat's unread badge — called the moment a conversation
  // is opened, rather than waiting for the next full chats refresh (which
  // could otherwise race with the server-side mark-as-read call and leave a
  // stale unread count showing after the user already read everything).
  const markChatRead = useCallback((contactId: string) => {
    updateData((prev) => {
      const idx = prev.chats.findIndex(c => c.user_id === contactId);
      if (idx === -1) return {};
      const chat = prev.chats[idx];
      if (!chat.unreadCount && (!chat.lastMessage || chat.lastMessage.is_read)) return {};
      const nextChats = [...prev.chats];
      nextChats[idx] = {
        ...chat,
        unreadCount: 0,
        lastMessage: chat.lastMessage && chat.lastMessage.receiver_id === userId
          ? { ...chat.lastMessage, is_read: true }
          : chat.lastMessage
      };
      return { chats: nextChats };
    });
  }, [userId, updateData]);

  const refreshFriends = useCallback(async () => {
    const result = await friendService.getFriends(userId);
    if (result.success && result.data) {
      const friends: Friend[] = result.data.friends.map(profile => ({
        id: profile.id,
        profile
      }));
      updateData({ friends });
      // Also refresh chats since friend list changed
      if (result.data.friendIds.length > 0) {
        const chats = await chatService.getChatList(userId, result.data.friendIds);
        updateData(prev => ({ chats: mergeChatLists(chats, prev.chats) }));
      }
    }
  }, [userId, updateData]);

  const refreshGroups = useCallback(async () => {
    const result = await groupService.getUserGroups(userId);
    if (result.success && result.data) {
      updateData({ groups: result.data });
    }
  }, [userId, updateData]);

  // Instantly zero a group's unread badge the moment it's opened — same
  // reasoning as markChatRead above: GroupChatView's own
  // groupService.markAsRead() call races the next debounced groups
  // refetch (up to 45s away), which would otherwise leave a stale badge
  // showing on a group the user is already looking at.
  const markGroupRead = useCallback((groupId: string) => {
    updateData((prev) => {
      const idx = prev.groups.findIndex(g => g.id === groupId);
      if (idx === -1) return {};
      const group = prev.groups[idx];
      if (!group.unreadCount) return {};
      const nextGroups = [...prev.groups];
      nextGroups[idx] = { ...group, unreadCount: 0 };
      return { groups: nextGroups };
    });
  }, [updateData]);

  const refreshRequests = useCallback(async () => {
    const [requestsResult, allProfiles, friendsResult] = await Promise.all([
      friendService.getRequests(userId),
      profileService.getAllProfiles(),
      friendService.getFriends(userId)
    ]);

    const friendRequests = requestsResult.success && requestsResult.data ? requestsResult.data.received : [];
    const sentRequests = requestsResult.success && requestsResult.data ? requestsResult.data.sent : [];
    const sentRequestIds = new Set(sentRequests.map(r => r.receiver_id));

    const friendIds = friendsResult.success && friendsResult.data ? friendsResult.data.friendIds : [];
    const requestSenderIds = new Set(friendRequests.map(r => r.sender_id));
    const friendIdSet = new Set(friendIds);

    // Include all users (both friends and non-friends) in suggestions
    const suggestions: Suggestion[] = allProfiles
      .filter(profile =>
        profile.id !== userId &&
        profile.full_name &&
        !requestSenderIds.has(profile.id) // Exclude users who sent us a request (they're in requests tab)
      )
      .map(profile => {
        const isFriend = friendIdSet.has(profile.id);
        return { id: profile.id, profile, isFriend };
      })
      // Sort: friends first, then by name
      .sort((a, b) => {
        if (a.isFriend && !b.isFriend) return -1;
        if (!a.isFriend && b.isFriend) return 1;
        return a.profile.full_name.localeCompare(b.profile.full_name);
      });

    updateData({ friendRequests, suggestions, sentRequestIds });

    // Keep the Friends tab (and Chats tab) in sync too — accepting/declining
    // a request, or cancelling a sent one, changes the friend list, but this
    // function already fetched it above so reuse it instead of a 2nd call.
    if (friendsResult.success && friendsResult.data) {
      const friends: Friend[] = friendsResult.data.friends.map(profile => ({
        id: profile.id,
        profile
      }));
      updateData({ friends });
      if (friendIds.length > 0) {
        const chats = await chatService.getChatList(userId, friendIds);
        updateData(prev => ({ chats: mergeChatLists(chats, prev.chats) }));
      }
    }
  }, [userId, updateData]);


  const refreshCallHistory = useCallback(async () => {
    const result = await callService.getCallHistory();
    if (result.success && result.data) {
      const historyItems: HistoryItem[] = result.data.map((call: CallHistory) => {
        const isOutgoing = call.caller_id === userId;
        const otherUserId = isOutgoing ? call.callee_id : call.caller_id;
        const profile = isOutgoing ? call.callee_profile : call.caller_profile;

        let direction: 'incoming' | 'outgoing' | 'missed' = 'outgoing';
        if (!isOutgoing) {
          direction = call.status === 'missed' ? 'missed' : 'incoming';
        } else if (call.status === 'missed') {
          direction = 'missed';
        }

        let durationStr: string | undefined;
        if (call.duration && call.duration > 0) {
          const minutes = Math.floor(call.duration / 60);
          const seconds = call.duration % 60;
          durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        return {
          id: call.id,
          name: profile?.full_name || 'Unknown',
          avatar: profile?.avatar_url,
          userId: otherUserId,
          type: call.call_type as 'voice' | 'video',
          direction,
          timestamp: call.started_at,
          duration: durationStr
        };
      });
      updateData({ callHistory: historyItems });
    }
  }, [userId, updateData]);

  // Add to sent requests (optimistic update)
  const addSentRequest = useCallback((targetUserId: string) => {
    const newSentIds = new Set(data.sentRequestIds);
    newSentIds.add(targetUserId);

    // Remove from suggestions
    const newSuggestions = data.suggestions.filter(s => s.id !== targetUserId);

    updateData({
      sentRequestIds: newSentIds,
      suggestions: newSuggestions
    });
  }, [data.sentRequestIds, data.suggestions, updateData]);

  // Load data on mount
  useEffect(() => {
    // If we have cached data, don't reload unless it's stale
    if (!globalCache.isReady) {
      loadAllData();
    } else {
      setData(globalCache);
      // Refresh in background
      loadAllData();
    }

    // Self-heal any local message storage left corrupted by a past sync bug
    // (see offlineStorage.repairDuplicateClientMessageIds) — fire-and-forget,
    // once per page load, so it never blocks or delays anything visible.
    if (!localMessageStoreRepaired) {
      localMessageStoreRepaired = true;
      chatService.repairLocalMessageStore().catch(() => {});
    }
  }, [loadAllData]);

  // DEBOUNCED refresh functions - prevents excessive updates
  const debouncedRefreshGroups = useMemo(
    () => debounce(refreshGroups, 300),
    [refreshGroups]
  );

  const debouncedRefreshCallHistory = useMemo(
    () => debounce(refreshCallHistory, 500),
    [refreshCallHistory]
  );

  // Combined refresh for friend-related changes (avoids double refresh)
  const debouncedRefreshFriendsAndRequests = useMemo(
    () => debounce(() => {
      refreshFriends();
      refreshRequests();
    }, 300),
    [refreshFriends, refreshRequests]
  );

  // Set up real-time subscriptions.
  // Messages and friend events arrive instantly over the shared per-user
  // WebSocket (src/lib/realtimeClient.ts, backed by the Worker's Durable
  // Objects). Chat-list updates (new message preview, unread badge, "seen"
  // ticks) are applied in place from the event payload — no network round
  // trip — so the list outside an open chat feels exactly as instant as the
  // chat itself. Groups/calls don't have that wiring yet, so they fall back
  // to light polling in the meantime — still "actually works", just not instant.
  useEffect(() => {
    realtimeClient.connect(userId);

    // Messages - applied instantly (see applyIncomingMessage/applyMessageUpdate)
    const messagesChannel = chatService.subscribeToMessages(
      userId,
      (message) => applyIncomingMessage(message),
      (message) => applyMessageUpdate(message)
    );
    subscriptionsRef.current.push(messagesChannel);

    // Read receipts - updates the "seen" tick on the Chats list instantly
    const readReceiptChannel = chatService.subscribeToReadReceipts(
      userId,
      (messageIds, readerId) => applyReadReceipt(readerId, messageIds)
    );
    subscriptionsRef.current.push(readReceiptChannel);

    // Friend requests sent to me, acceptances/declines of requests I sent,
    // and the other side unfriending me — all need to refresh both the
    // Friends and Chats tabs live.
    const friendRequestSub = realtimeClient.on('friend:request', () => debouncedRefreshFriendsAndRequests());
    const friendAcceptedSub = realtimeClient.on('friend:accepted', () => debouncedRefreshFriendsAndRequests());
    const friendDeclinedSub = realtimeClient.on('friend:declined', () => debouncedRefreshFriendsAndRequests());
    const friendRemovedSub = realtimeClient.on('friend:removed', () => debouncedRefreshFriendsAndRequests());
    subscriptionsRef.current.push(friendRequestSub, friendAcceptedSub, friendDeclinedSub, friendRemovedSub);

    // Groups: created/renamed/deleted, and any membership change (joined,
    // left, promoted/demoted) all just trigger a full refetch rather than
    // trying to hand-merge a partial payload — getUserGroups() is the one
    // source of truth for the shape the Groups list and an open group
    // chat's header both render from.
    const groupCreatedOrUpdatedSub = realtimeClient.on('group:created', () => debouncedRefreshGroups());
    const groupUpdatedSub = realtimeClient.on('group:updated', () => debouncedRefreshGroups());
    const groupDeletedSub = realtimeClient.on('group:deleted', () => debouncedRefreshGroups());
    const groupMemberJoinedSub = realtimeClient.on('group-member:joined', () => debouncedRefreshGroups());
    const groupMemberLeftSub = realtimeClient.on('group-member:left', () => debouncedRefreshGroups());
    const groupMemberUpdatedSub = realtimeClient.on('group-member:updated', () => debouncedRefreshGroups());
    // A new group message changes the list's "last message" preview too.
    const groupMessageSub = realtimeClient.on('group-message:new', () => debouncedRefreshGroups());
    subscriptionsRef.current.push(
      groupCreatedOrUpdatedSub,
      groupUpdatedSub,
      groupDeletedSub,
      groupMemberJoinedSub,
      groupMemberLeftSub,
      groupMemberUpdatedSub,
      groupMessageSub
    );

    // Call history: a call landing in the History tab the moment it ends
    // (rather than up to 30s later) matters since that's also how a missed
    // call notification would be noticed.
    const callEndedSub = realtimeClient.on('call:ended', () => debouncedRefreshCallHistory());
    subscriptionsRef.current.push(callEndedSub);

    // These intervals are now just a safety net in case a realtime event is
    // ever missed (e.g. a brief reconnect gap) — both are kept live above.
    const groupsInterval = setInterval(() => debouncedRefreshGroups(), 45000);
    const callsInterval = setInterval(() => debouncedRefreshCallHistory(), 45000);

    // Online/offline status has no realtime push of its own (it's a simple
    // heartbeat timestamp in D1, see profileService.updateLastSeen) — poll
    // friends/chats/suggestions periodically so "Online"/"Last seen" stays
    // reasonably fresh everywhere it's shown.
    const presenceInterval = setInterval(() => debouncedRefreshFriendsAndRequests(), 25000);

    return () => {
      subscriptionsRef.current.forEach(sub => sub.unsubscribe());
      subscriptionsRef.current = [];
      clearInterval(groupsInterval);
      clearInterval(callsInterval);
      clearInterval(presenceInterval);
    };
  }, [userId, applyIncomingMessage, applyMessageUpdate, applyReadReceipt, debouncedRefreshGroups, debouncedRefreshFriendsAndRequests, debouncedRefreshCallHistory]);

  return {
    ...data,
    typingUsers,
    setTypingUsers,
    refreshChats,
    refreshFriends,
    refreshGroups,
    refreshRequests,
    refreshCallHistory,
    markChatRead,
    markGroupRead,
    addSentRequest,
    reload: loadAllData
  };
}

// Reset cache on logout
export function clearAppDataCache() {
  globalCache = { ...INITIAL_DATA };
  // Also clear localStorage instant cache
  try {
    localStorage.removeItem(INSTANT_CACHE_KEY);
  } catch {
    // Silently fail
  }
}
