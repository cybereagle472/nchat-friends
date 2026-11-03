import { Search, Settings, Plus, Image, Mic, Video, FileText, MapPin, Check, CheckCheck } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { typingService } from '../services/typingService';
import { chatService } from '../services/chatService';
import { matchesQuery } from '../utils/search';
import { Contact, UserProfile } from '../types';

// Track prefetch status to avoid redundant calls
let prefetchedChatsSet = new Set<string>();

interface ChatsProps {
  currentUser: UserProfile;
  chats: Contact[];
  onOpenChat: (contact: Contact) => void;
  onCreateNewChat: () => void;
  onOpenSettings?: () => void;
}

export function Chats({ currentUser, chats, onOpenChat, onCreateNewChat, onOpenSettings }: ChatsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [recordingUsers, setRecordingUsers] = useState<Set<string>>(new Set());
  const typingSubscriptionsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
  const recordingSubscriptionsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());

  // Unread counts and "seen" ticks come straight from the `chats` prop now —
  // it's kept live and instant by useAppData's realtime message/read-receipt
  // handling, so there's no need (and no benefit) to shadow it with separate
  // local state here.
  const handleOpenChat = useCallback((contact: Contact) => {
    onOpenChat(contact);
  }, [onOpenChat]);

  // Subscribe to typing indicators.
  // IMPORTANT: this used to depend on the whole `chats` array, which gets a
  // brand new reference from useAppData on essentially every live update
  // (a new message, a read receipt, an online-status change, etc. — not
  // just when a friend is added/removed). Every one of those re-renders
  // was tearing down *every* friend's typing subscription and immediately
  // re-creating all of them from scratch, over and over, all day. Depending
  // on just the sorted list of friend ids instead means this effect only
  // actually re-runs when someone is added to or removed from the chat
  // list, and reconciling instead of blindly clearing+rebuilding means an
  // existing, perfectly fine subscription is never needlessly recreated.
  const friendIdsKey = chats.map(chat => chat.user_id).sort().join(',');

  useEffect(() => {
    const friendIds = friendIdsKey ? friendIdsKey.split(',') : [];
    const friendIdSet = new Set(friendIds);
    const subscriptions = typingSubscriptionsRef.current;

    // Drop subscriptions for friends no longer in the list.
    subscriptions.forEach((sub, friendId) => {
      if (!friendIdSet.has(friendId)) {
        sub.unsubscribe();
        subscriptions.delete(friendId);
      }
    });

    // Add subscriptions for any new friends.
    friendIds.forEach(friendId => {
      if (!subscriptions.has(friendId)) {
        const subscription = typingService.subscribeToTyping(
          currentUser.id,
          friendId,
          (userId, isTyping) => {
            setTypingUsers(prev => {
              const newSet = new Set(prev);
              if (isTyping) {
                newSet.add(userId);
              } else {
                newSet.delete(userId);
              }
              return newSet;
            });
          }
        );
        subscriptions.set(friendId, subscription);
      }
    });
    // No cleanup here on purpose — subscriptions are reconciled in place
    // above, and the unmount-only effect below handles final teardown.
  }, [currentUser.id, friendIdsKey]);

  // Same reconciliation pattern as typing, for the "recording a voice
  // message" indicator — kept as its own effect/ref-map pair so a bug in
  // one can never affect the other, but following the exact same
  // diff-instead-of-rebuild approach that fixed the typing churn bug.
  useEffect(() => {
    const friendIds = friendIdsKey ? friendIdsKey.split(',') : [];
    const friendIdSet = new Set(friendIds);
    const subscriptions = recordingSubscriptionsRef.current;

    subscriptions.forEach((sub, friendId) => {
      if (!friendIdSet.has(friendId)) {
        sub.unsubscribe();
        subscriptions.delete(friendId);
      }
    });

    friendIds.forEach(friendId => {
      if (!subscriptions.has(friendId)) {
        const subscription = typingService.subscribeToRecording(
          currentUser.id,
          friendId,
          (userId, isRecording) => {
            setRecordingUsers(prev => {
              const newSet = new Set(prev);
              if (isRecording) {
                newSet.add(userId);
              } else {
                newSet.delete(userId);
              }
              return newSet;
            });
          }
        );
        subscriptions.set(friendId, subscription);
      }
    });
  }, [currentUser.id, friendIdsKey]);

  // Unmount-only cleanup — intentionally NOT tied to `chats`/currentUser.id,
  // otherwise this would tear down every subscription on every list
  // refresh, which is exactly the churn the effect above was just fixed
  // to avoid.
  useEffect(() => {
    return () => {
      typingSubscriptionsRef.current.forEach(sub => sub.unsubscribe());
      typingSubscriptionsRef.current.clear();
      recordingSubscriptionsRef.current.forEach(sub => sub.unsubscribe());
      recordingSubscriptionsRef.current.clear();
    };
  }, []);

  // Pre-fetch messages for top chats (WhatsApp-style instant loading)
  useEffect(() => {
    if (chats.length === 0) return;

    // Get IDs of chats that haven't been prefetched yet
    const chatsToPrefetch = chats
      .slice(0, 10) // Prefetch top 10 chats
      .filter(chat => !prefetchedChatsSet.has(chat.user_id))
      .map(chat => chat.user_id);

    if (chatsToPrefetch.length > 0) {
      // Mark as prefetched immediately to avoid duplicate calls
      chatsToPrefetch.forEach(id => prefetchedChatsSet.add(id));

      // Prefetch in background (non-blocking)
      chatService.prefetchChatsMessages(currentUser.id, chatsToPrefetch).catch(() => {
        // On error, remove from set so it can be retried
        chatsToPrefetch.forEach(id => prefetchedChatsSet.delete(id));
      });
    }
  }, [currentUser.id, chats]);

  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return '';
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

  const getMessagePreview = (chat: Contact) => {
    if (recordingUsers.has(chat.user_id) || typingUsers.has(chat.user_id)) {
      return null;
    }

    if (!chat.lastMessage) return { text: 'No messages yet', icon: null, deliveryStatus: null };

    const isMe = chat.lastMessage.sender_id === currentUser.id;
    // WhatsApp-style delivery tick, only for messages *I* sent: a single
    // gray check once it's reached the server, a double blue check once the
    // other person has read it (kept live by applyReadReceipt in useAppData).
    const deliveryStatus: 'sent' | 'read' | null = isMe
      ? (chat.lastMessage.is_read ? 'read' : 'sent')
      : null;

    switch (chat.lastMessage.type) {
      case 'image':
        return { text: `Photo`, icon: <Image className="w-4 h-4" />, deliveryStatus };
      case 'voice':
        return { text: `Voice message`, icon: <Mic className="w-4 h-4" />, deliveryStatus };
      case 'video':
        return { text: `Video`, icon: <Video className="w-4 h-4" />, deliveryStatus };
      case 'file':
        return { text: `Document`, icon: <FileText className="w-4 h-4" />, deliveryStatus };
      case 'gif':
        return { text: `GIF`, icon: null, deliveryStatus };
      case 'location':
        return { text: `Location`, icon: <MapPin className="w-4 h-4" />, deliveryStatus };
      default:
        return { text: `${chat.lastMessage.content}`, icon: null, deliveryStatus };
    }
  };

  const filteredChats = chats.filter(chat =>
    matchesQuery(searchQuery, chat.profile.full_name, chat.profile.username)
  );

  return (
    <div className="chat-list-container">
      {/* Header */}
      <div className="chat-list-header">
        <div className="chat-list-header-top">
          <h1 className="chat-list-title">Chats</h1>
          <div className="chat-list-actions">
            <button onClick={onCreateNewChat} className="chat-list-action-btn" aria-label="Create new chat">
              <Plus className="w-5 h-5" strokeWidth={2.5} />
            </button>
            {onOpenSettings && (
              <button onClick={onOpenSettings} className="chat-list-action-btn" aria-label="Settings">
                <Settings className="w-5 h-5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="chat-list-search">
          <Search className="chat-list-search-icon" strokeWidth={2} />
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="chat-list-search-input"
          />
        </div>
      </div>

      {/* Chat List */}
      <div className="chat-list-content">
        {filteredChats.length === 0 ? (
          <div className="chat-list-empty">
            <div className="chat-list-empty-icon">
              <span className="text-4xl">{searchQuery ? '🔍' : '💬'}</span>
            </div>
            <p className="text-base font-medium text-slate-700 mb-1">
              {searchQuery ? 'No chats found' : 'No chats yet'}
            </p>
            <p className="text-sm text-slate-500 text-center">
              {searchQuery ? 'Try a different search' : 'Start a conversation with your friends'}
            </p>
          </div>
        ) : (
          <div className="chat-list-items">
            {filteredChats.map((chat) => {
              const isRecording = recordingUsers.has(chat.user_id);
              const isTyping = !isRecording && typingUsers.has(chat.user_id);
              const messagePreview = getMessagePreview(chat);
              const unreadCount = chat.unreadCount || 0;
              const hasUnread = unreadCount > 0;

              return (
                <div
                  key={chat.user_id}
                  onClick={() => handleOpenChat(chat)}
                  className="chat-list-item"
                >
                  {/* Avatar */}
                  <div className="chat-list-avatar-container">
                    <div className="chat-list-avatar">
                      {chat.profile.avatar_url ? (
                        <img
                          src={chat.profile.avatar_url}
                          alt={chat.profile.full_name}
                        />
                      ) : (
                        <span>{chat.profile.full_name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    {chat.profile.is_online && <div className="chat-list-online-dot" />}
                  </div>

                  {/* Chat Info */}
                  <div className="chat-list-info">
                    <div className="chat-list-info-top">
                      <span className={`chat-list-name ${hasUnread ? 'unread' : ''}`}>
                        {chat.profile.full_name}
                      </span>
                      <span className={`chat-list-time ${hasUnread ? 'unread' : ''}`}>
                        {formatTimestamp(chat.lastMessage?.created_at)}
                      </span>
                    </div>
                    <div className="chat-list-info-bottom">
                      {isRecording ? (
                        <div className="chat-list-typing">
                          <Mic className="w-3 h-3 recording-indicator-mic" strokeWidth={2.5} />
                          <span>recording audio</span>
                          <div className="chat-list-typing-dots">
                            <span style={{ animationDelay: '0ms' }} />
                            <span style={{ animationDelay: '150ms' }} />
                            <span style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      ) : isTyping ? (
                        <div className="chat-list-typing">
                          <span>typing</span>
                          <div className="chat-list-typing-dots">
                            <span style={{ animationDelay: '0ms' }} />
                            <span style={{ animationDelay: '150ms' }} />
                            <span style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      ) : messagePreview && (
                        <div className={`chat-list-preview ${hasUnread ? 'unread' : ''}`}>
                          {messagePreview.deliveryStatus && (
                            <span className="chat-list-preview-icon chat-list-delivery-tick">
                              {messagePreview.deliveryStatus === 'read' ? (
                                <CheckCheck className="w-3.5 h-3.5 text-sky-500" strokeWidth={2.5} />
                              ) : (
                                <Check className="w-3.5 h-3.5 text-slate-400" strokeWidth={2.5} />
                              )}
                            </span>
                          )}
                          {messagePreview.icon && <span className="chat-list-preview-icon">{messagePreview.icon}</span>}
                          <span className="chat-list-preview-text">{messagePreview.text}</span>
                        </div>
                      )}

                      {hasUnread && (
                        <span className="chat-list-badge">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .chat-list-container {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: transparent;
        }

        .chat-list-header {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.95) 0%, rgba(168, 85, 247, 0.95) 50%, rgba(217, 70, 239, 0.95) 100%);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          padding: 16px;
          padding-top: 16px;
          box-shadow: 0 4px 20px rgba(139, 92, 246, 0.25);
        }

        .chat-list-header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .chat-list-title {
          font-size: 24px;
          font-weight: 700;
          color: white;
          letter-spacing: -0.5px;
        }

        .chat-list-actions {
          display: flex;
          gap: 4px;
        }

        .chat-list-action-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: transparent;
          border: none;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s;
        }

        .chat-list-action-btn:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .chat-list-search {
          position: relative;
        }

        .chat-list-search-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          width: 16px;
          height: 16px;
          color: rgba(255, 255, 255, 0.7);
        }

        .chat-list-search-input {
          width: 100%;
          padding: 12px 16px 12px 44px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          font-size: 14px;
          color: white;
          outline: none;
          transition: all 0.3s ease;
        }

        .chat-list-search-input::placeholder {
          color: rgba(255, 255, 255, 0.6);
        }

        .chat-list-search-input:focus {
          background: rgba(255, 255, 255, 0.25);
          border-color: rgba(255, 255, 255, 0.3);
        }

        .chat-list-content {
          flex: 1;
          overflow-y: auto;
        }

        /* Upgraded to the app's shared glassmorphism recipe (see .glass-card
           in globals.css) instead of the old flat bg-white/50 approximation
           — this is the very first thing a new user with no chats yet sees,
           so it's one of the most visible places that look should land. */
        .chat-list-empty {
          position: relative;
          overflow: hidden;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: rgba(255, 255, 255, 0.22);
          -webkit-backdrop-filter: blur(18px) saturate(150%);
          backdrop-filter: blur(18px) saturate(150%);
          margin: 12px;
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.55);
          box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.18),
            inset 0 1px 0 rgba(255, 255, 255, 0.6),
            inset 0 -1px 0 rgba(255, 255, 255, 0.15),
            inset 0 0 48px 24px rgba(255, 255, 255, 0.4);
        }

        .chat-list-empty::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.8), transparent);
        }

        .chat-list-empty::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 1px;
          height: 100%;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.8), transparent, rgba(255, 255, 255, 0.3));
        }

        .chat-list-empty-icon {
          width: 80px;
          height: 80px;
          border-radius: 20px;
          background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 50%, #d946ef 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
          box-shadow: 0 4px 20px rgba(139, 92, 246, 0.35);
        }

        .chat-list-items {
          padding: 12px;
        }

        .chat-list-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          cursor: pointer;
          transition: all 0.2s ease;
          border-radius: 16px;
          margin-bottom: 8px;
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.8);
        }

        .chat-list-avatar-container {
          position: relative;
          flex-shrink: 0;
        }

        .chat-list-avatar {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 50%, #d946ef 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          box-shadow: 0 3px 12px rgba(139, 92, 246, 0.3);
        }

        .chat-list-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .chat-list-avatar span {
          font-size: 20px;
          font-weight: 600;
          color: white;
        }

        .chat-list-online-dot {
          position: absolute;
          bottom: 2px;
          right: 2px;
          width: 14px;
          height: 14px;
          background: #22c55e;
          border-radius: 50%;
          border: 2.5px solid #f8fafc;
        }

        .chat-list-info {
          flex: 1;
          min-width: 0;
        }

        .chat-list-info-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 4px;
        }

        .chat-list-name {
          font-size: 16px;
          font-weight: 600;
          color: #334155;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chat-list-name.unread {
          color: #0f172a;
        }

        .chat-list-time {
          font-size: 12px;
          color: #94a3b8;
          flex-shrink: 0;
          margin-left: 8px;
        }

        .chat-list-time.unread {
          color: #8b5cf6;
          font-weight: 600;
        }

        .chat-list-info-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .chat-list-typing {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #8b5cf6;
          font-size: 14px;
          font-weight: 500;
        }

        .chat-list-typing-dots {
          display: flex;
          gap: 3px;
        }

        .chat-list-typing-dots span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #8b5cf6;
          animation: typing-bounce 1.4s infinite ease-in-out;
        }

        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }

        .chat-list-preview {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
          font-size: 14px;
          color: #64748b;
        }

        .chat-list-preview.unread {
          color: #475569;
          font-weight: 500;
        }

        .chat-list-preview-icon {
          color: #94a3b8;
          flex-shrink: 0;
          display: flex;
        }

        .chat-list-preview-text {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chat-list-badge {
          flex-shrink: 0;
          min-width: 22px;
          height: 22px;
          padding: 0 7px;
          border-radius: 11px;
          background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 50%, #d946ef 100%);
          color: white;
          font-size: 12px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
        }

        .chat-list-item:hover {
          background: rgba(255, 255, 255, 0.9);
          transform: scale(1.02);
          box-shadow: 0 4px 15px rgba(139, 92, 246, 0.15);
        }

        .chat-list-item:active {
          transform: scale(0.98);
        }
      `}</style>
    </div>
  );
}
