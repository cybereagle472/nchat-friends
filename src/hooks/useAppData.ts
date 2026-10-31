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
import { Contact, UserProfile, FriendRequest, CallHistory } from '../types';
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

export function useAppData(userId: string) {
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

  // Update both state and global cache, and save to localStorage
  const updateData = useCallback((updates: Partial<AppData>) => {
    globalCache = { ...globalCache, ...updates };
    setData(prev => {
      const newData = { ...prev, ...updates };
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
        callService.getCallHistory(userId)
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

      updateData({
        chats,
        friends,
        groups,
        friendRequests,
        suggestions,
        sentRequestIds,
        callHistory: historyItems,
        isReady: true
      });

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
      updateData({ chats });
    }
  }, [userId, data.friends, updateData]);

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
        updateData({ chats });
      }
    }
  }, [userId, updateData]);

  const refreshGroups = useCallback(async () => {
    const result = await groupService.getUserGroups(userId);
    if (result.success && result.data) {
      updateData({ groups: result.data });
    }
  }, [userId, updateData]);

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
        updateData({ chats });
      }
    }
  }, [userId, updateData]);


  const refreshCallHistory = useCallback(async () => {
    const result = await callService.getCallHistory(userId);
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
  }, [loadAllData]);

  // DEBOUNCED refresh functions - prevents excessive updates
  const debouncedRefreshChats = useMemo(
    () => debounce(refreshChats, 300),
    [refreshChats]
  );

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

  // Set up real-time subscriptions with DEBOUNCED callbacks.
  // Messages and friend events arrive instantly over the shared per-user
  // WebSocket (src/lib/realtimeClient.ts, backed by the Worker's Durable
  // Objects). Groups/calls don't have that wiring yet, so they fall back to
  // light polling in the meantime — still "actually works", just not instant.
  useEffect(() => {
    realtimeClient.connect(userId);

    // Messages - debounced to batch rapid messages
    const messagesChannel = chatService.subscribeToMessages(
      userId,
      () => debouncedRefreshChats(),
      () => debouncedRefreshChats()
    );
    subscriptionsRef.current.push(messagesChannel);

    // Friend requests sent to me, acceptances/declines of requests I sent,
    // and the other side unfriending me — all need to refresh both the
    // Friends and Chats tabs live.
    const friendRequestSub = realtimeClient.on('friend:request', () => debouncedRefreshFriendsAndRequests());
    const friendAcceptedSub = realtimeClient.on('friend:accepted', () => debouncedRefreshFriendsAndRequests());
    const friendDeclinedSub = realtimeClient.on('friend:declined', () => debouncedRefreshFriendsAndRequests());
    const friendRemovedSub = realtimeClient.on('friend:removed', () => debouncedRefreshFriendsAndRequests());
    subscriptionsRef.current.push(friendRequestSub, friendAcceptedSub, friendDeclinedSub, friendRemovedSub);

    // Groups / call history: poll periodically until they get dedicated
    // realtime events of their own.
    const groupsInterval = setInterval(() => debouncedRefreshGroups(), 20000);
    const callsInterval = setInterval(() => debouncedRefreshCallHistory(), 30000);

    return () => {
      subscriptionsRef.current.forEach(sub => sub.unsubscribe());
      subscriptionsRef.current = [];
      clearInterval(groupsInterval);
      clearInterval(callsInterval);
    };
  }, [userId, debouncedRefreshChats, debouncedRefreshGroups, debouncedRefreshFriendsAndRequests, debouncedRefreshCallHistory]);

  return {
    ...data,
    typingUsers,
    setTypingUsers,
    refreshChats,
    refreshFriends,
    refreshGroups,
    refreshRequests,
    refreshCallHistory,
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
