import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Plus, Search, ChevronRight, Mic, Check, CheckCheck, Image, Video, FileText, MapPin } from 'lucide-react';
import { GroupWithMembers } from '../services/groupService';
import { UserProfile } from '../types';
import { typingService } from '../services/typingService';

interface GroupsProps {
  currentUser: UserProfile;
  groups: GroupWithMembers[];
  onOpenGroup: (group: GroupWithMembers) => void;
  onCreateGroup: () => void;
}

export function Groups({ currentUser, groups, onOpenGroup, onCreateGroup }: GroupsProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Typing/recording previews for every group row — same reconciliation
  // pattern as Chats.tsx's per-friend typing subscriptions (diff instead of
  // rebuild, keyed off a stable sorted-ids string rather than the whole
  // `groups` array, which gets a fresh reference on practically every live
  // update). The one structural difference from Chats.tsx is that a group
  // can have more than one member typing/recording at once, so each group
  // id maps to a Set of active member ids instead of a single boolean.
  const [typingByGroup, setTypingByGroup] = useState<Map<string, Set<string>>>(new Map());
  const [recordingByGroup, setRecordingByGroup] = useState<Map<string, Set<string>>>(new Map());
  const typingSubscriptionsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
  const recordingSubscriptionsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());

  const groupIdsKey = groups.map(group => group.id).sort().join(',');

  useEffect(() => {
    const groupIds = groupIdsKey ? groupIdsKey.split(',') : [];
    const groupIdSet = new Set(groupIds);
    const subscriptions = typingSubscriptionsRef.current;

    subscriptions.forEach((sub, groupId) => {
      if (!groupIdSet.has(groupId)) {
        sub.unsubscribe();
        subscriptions.delete(groupId);
        setTypingByGroup(prev => {
          if (!prev.has(groupId)) return prev;
          const next = new Map(prev);
          next.delete(groupId);
          return next;
        });
      }
    });

    groupIds.forEach(groupId => {
      if (!subscriptions.has(groupId)) {
        const subscription = typingService.subscribeToGroupTyping(
          currentUser.id,
          groupId,
          (userId, isTyping) => {
            setTypingByGroup(prev => {
              const next = new Map(prev);
              const current = new Set(next.get(groupId));
              if (isTyping) current.add(userId); else current.delete(userId);
              next.set(groupId, current);
              return next;
            });
          }
        );
        subscriptions.set(groupId, subscription);
      }
    });
  }, [currentUser.id, groupIdsKey]);

  useEffect(() => {
    const groupIds = groupIdsKey ? groupIdsKey.split(',') : [];
    const groupIdSet = new Set(groupIds);
    const subscriptions = recordingSubscriptionsRef.current;

    subscriptions.forEach((sub, groupId) => {
      if (!groupIdSet.has(groupId)) {
        sub.unsubscribe();
        subscriptions.delete(groupId);
        setRecordingByGroup(prev => {
          if (!prev.has(groupId)) return prev;
          const next = new Map(prev);
          next.delete(groupId);
          return next;
        });
      }
    });

    groupIds.forEach(groupId => {
      if (!subscriptions.has(groupId)) {
        const subscription = typingService.subscribeToGroupRecording(
          currentUser.id,
          groupId,
          (userId, isRecording) => {
            setRecordingByGroup(prev => {
              const next = new Map(prev);
              const current = new Set(next.get(groupId));
              if (isRecording) current.add(userId); else current.delete(userId);
              next.set(groupId, current);
              return next;
            });
          }
        );
        subscriptions.set(groupId, subscription);
      }
    });
  }, [currentUser.id, groupIdsKey]);

  // Unmount-only cleanup — intentionally not tied to `groups`/currentUser.id
  // for the same reconciliation reasons as Chats.tsx.
  useEffect(() => {
    return () => {
      typingSubscriptionsRef.current.forEach(sub => sub.unsubscribe());
      typingSubscriptionsRef.current.clear();
      recordingSubscriptionsRef.current.forEach(sub => sub.unsubscribe());
      recordingSubscriptionsRef.current.clear();
    };
  }, []);

  // Turn a group's active typing/recording member ids into a short,
  // WhatsApp-style label using that group's own member profiles (already
  // loaded on the `group` object, so no extra lookups are needed) —
  // recording takes priority over typing for a member doing both.
  const getActivity = useCallback((group: GroupWithMembers): { kind: 'recording' | 'typing'; label: string } | null => {
    const recordingIds = recordingByGroup.get(group.id);
    const typingIds = typingByGroup.get(group.id);

    const activeRecording = recordingIds && recordingIds.size > 0 ? recordingIds : null;
    const activeTyping = !activeRecording && typingIds && typingIds.size > 0
      ? new Set(Array.from(typingIds).filter(id => !recordingIds?.has(id)))
      : null;

    const ids = activeRecording ?? (activeTyping && activeTyping.size > 0 ? activeTyping : null);
    if (!ids || ids.size === 0) return null;

    const names = Array.from(ids).map(
      id => group.members.find(m => m.user_id === id)?.profile?.full_name?.split(' ')[0] || 'Someone'
    );
    const label = names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names[0]} and ${names.length - 1} others`;

    return { kind: activeRecording ? 'recording' : 'typing', label };
  }, [recordingByGroup, typingByGroup]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  // Mirrors Chats.tsx's getMessagePreview exactly (same media-type labels
  // and icons, same "You"/read-tick treatment for your own last message),
  // plus two things a group preview needs that a 1:1 one doesn't:
  //  - a sender name, since a group has more than one possible sender;
  //  - a lastMessage.sender_profile fallback through the group's own
  //    member list. The server's lastMessage payload doesn't embed a
  //    sender_profile at all (see worker/src/routes/groups.ts's
  //    groupMessageJson), so without this every row fell back straight to
  //    "Someone" — the member list already has everyone's profile right
  //    there in the same response, the same way useGroupChat.ts already
  //    resolves sender profiles for live-arriving messages.
  const getGroupMessagePreview = useCallback(
    (group: GroupWithMembers) => {
      const lastMessage = group.lastMessage;
      if (!lastMessage) return { senderLabel: null as string | null, icon: null as React.ReactNode, text: 'No messages yet', deliveryStatus: null as 'sent' | 'read' | null };

      const isMe = lastMessage.sender_id === currentUser.id;
      const deliveryStatus: 'sent' | 'read' | null = isMe ? (lastMessage.is_read ? 'read' : 'sent') : null;
      const senderProfile = lastMessage.sender_profile ?? group.members.find((m) => m.user_id === lastMessage.sender_id)?.profile;
      const senderLabel = isMe ? 'You' : senderProfile?.full_name?.split(' ')[0] || 'Someone';

      switch (lastMessage.type) {
        case 'image':
          return { senderLabel, icon: <Image className="w-3.5 h-3.5" />, text: 'Photo', deliveryStatus };
        case 'voice':
          return { senderLabel, icon: <Mic className="w-3.5 h-3.5" />, text: 'Voice message', deliveryStatus };
        case 'video':
          return { senderLabel, icon: <Video className="w-3.5 h-3.5" />, text: 'Video', deliveryStatus };
        case 'file':
          return { senderLabel, icon: <FileText className="w-3.5 h-3.5" />, text: 'Document', deliveryStatus };
        case 'gif':
          return { senderLabel, icon: null, text: 'GIF', deliveryStatus };
        case 'location':
          return { senderLabel, icon: <MapPin className="w-3.5 h-3.5" />, text: 'Location', deliveryStatus };
        default:
          return { senderLabel, icon: null, text: lastMessage.content || 'Sent a message', deliveryStatus };
      }
    },
    [currentUser.id]
  );

  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-4 py-3.5 shadow-xl shadow-purple-500/20">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5" strokeWidth={2.5} />
            Groups
          </h1>
          <button
            onClick={onCreateGroup}
            className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-all duration-300 hover:scale-110 active:scale-95"
            aria-label="Create group"
          >
            <Plus className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/70" strokeWidth={2.5} />
          <input
            type="text"
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 text-white placeholder-white/60 text-sm focus:outline-none focus:ring-2 focus:ring-white/40"
          />
        </div>
      </div>

      {/* Groups List */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full backdrop-blur-lg bg-white/50 rounded-2xl border border-white/70 p-8">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center text-3xl mb-4 shadow-lg shadow-purple-500/30">
              <Users className="w-10 h-10 text-white" />
            </div>
            <p className="text-sm text-slate-600 font-medium mb-1">
              {searchQuery ? 'No groups found' : 'No groups yet'}
            </p>
            <p className="text-xs text-slate-500 text-center mb-4">
              {searchQuery ? 'Try a different search' : 'Create a group to chat with friends'}
            </p>
            {!searchQuery && (
              <button
                onClick={onCreateGroup}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white text-sm font-medium shadow-lg shadow-purple-500/30 hover:shadow-xl hover:scale-105 transition-all duration-300"
              >
                <Plus className="w-4 h-4 inline mr-1" strokeWidth={2.5} />
                Create Group
              </button>
            )}
          </div>
        ) : (
          filteredGroups.map((group, index) => {
            const activity = getActivity(group);
            const preview = getGroupMessagePreview(group);
            return (
            <button
              key={group.id}
              onClick={() => onOpenGroup(group)}
              style={{ animationDelay: `${index * 30}ms` }}
              className="w-full flex items-center gap-3 p-3 mb-2 rounded-2xl backdrop-blur-xl bg-white/70 border border-white/70 hover:bg-white/90 hover:shadow-lg hover:shadow-purple-500/15 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] animate-slide-up group text-left"
            >
              {/* Group Avatar */}
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl flex-shrink-0 shadow-md group-hover:scale-105 transition-transform duration-300 overflow-hidden bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 shadow-purple-500/20">
                {group.avatar_url ? (
                  <img src={group.avatar_url} alt={group.name} className="w-full h-full object-cover" />
                ) : (
                  <Users className="w-6 h-6 text-white" />
                )}
              </div>

              {/* Group Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <h3 className="text-sm font-semibold text-slate-800 group-hover:text-violet-600 transition-colors truncate">
                    {group.name}
                  </h3>
                  {group.lastMessage && (
                    <span className="text-[10px] text-slate-500 flex-shrink-0 ml-2">
                      {formatTime(group.lastMessage.created_at)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <p className="text-xs text-slate-500 truncate flex-1">
                    {activity ? (
                      <span className="inline-flex items-center gap-1.5 text-violet-600 font-medium">
                        {activity.kind === 'recording' && (
                          <Mic className="w-3 h-3 recording-indicator-mic shrink-0" strokeWidth={2.5} />
                        )}
                        <span className="truncate">
                          {activity.label} {activity.kind === 'recording' ? 'recording audio' : 'typing'}
                        </span>
                        <span className="flex items-end gap-0.5 h-2 shrink-0">
                          <span className="w-1 h-1 bg-violet-500 rounded-full typing-dot" style={{ animationDelay: '0ms' }} />
                          <span className="w-1 h-1 bg-violet-500 rounded-full typing-dot" style={{ animationDelay: '150ms' }} />
                          <span className="w-1 h-1 bg-violet-500 rounded-full typing-dot" style={{ animationDelay: '300ms' }} />
                        </span>
                      </span>
                    ) : group.lastMessage ? (
                      <>
                        {preview.deliveryStatus && (
                          preview.deliveryStatus === 'read' ? (
                            <CheckCheck className="inline w-3.5 h-3.5 text-sky-500 mr-1 align-text-bottom" strokeWidth={2.5} />
                          ) : (
                            <Check className="inline w-3.5 h-3.5 text-slate-400 mr-1 align-text-bottom" strokeWidth={2.5} />
                          )
                        )}
                        <span className="font-medium text-slate-600">{preview.senderLabel}:</span>{' '}
                        {preview.icon && (
                          <span className="inline-flex items-center align-text-bottom mr-1">{preview.icon}</span>
                        )}
                        {preview.text}
                      </>
                    ) : (
                      <span className="text-slate-400">No messages yet</span>
                    )}
                  </p>
                  {group.unreadCount && group.unreadCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 text-white text-[10px] font-bold shadow-sm flex-shrink-0">
                      {group.unreadCount > 99 ? '99+' : group.unreadCount}
                    </span>
                  )}
                </div>

                <p className="text-[10px] text-slate-400 mt-0.5">
                  {group.members?.length || 0} members
                </p>
              </div>

              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-violet-500 transition-colors flex-shrink-0" />
            </button>
            );
          })
        )}
      </div>
    </div>
  );
}
