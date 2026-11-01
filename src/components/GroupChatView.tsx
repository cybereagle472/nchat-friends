import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Phone,
  Video,
  Send,
  Image,
  Paperclip,
  Smile,
  Mic,
  Users,
  Clock,
  Check,
  CheckCheck,
  X,
  Trash2
} from 'lucide-react';
import { useGroupChat, GroupMessageWithStatus } from '../hooks/useGroupChat';
import { GroupWithMembers, groupService } from '../services/groupService';
import { UserProfile, GroupMessage } from '../types';
import { mediaService } from '../services/mediaService';
import { GroupMessageActions, GroupReactionsDisplay } from './GroupMessageActions';

interface GroupChatViewProps {
  currentUser: UserProfile;
  group: GroupWithMembers;
  onBack: () => void;
  onGroupCall?: (type: 'voice' | 'video') => void;
  onManageGroup: () => void;
}

export function GroupChatView({ currentUser, group, onBack, onGroupCall, onManageGroup }: GroupChatViewProps) {
  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Message Actions State
  const [selectedMessage, setSelectedMessage] = useState<GroupMessageWithStatus | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState({ x: 0, y: 0 });
  const [replyToMessage, setReplyToMessage] = useState<GroupMessageWithStatus | null>(null);

  // Long press handling refs
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const {
    messages,
    members,
    memberProfiles,
    isLoading,
    isSending,
    isOnline,
    error,
    sendMessage,
    loadMessages,
    loadMoreMessages,
    hasMore
  } = useGroupChat({
    groupId: group.id,
    userId: currentUser.id
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load messages on mount
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const handleSendMessage = useCallback(async () => {
    const text = messageText.trim();
    if (!text || isSending) return;

    setMessageText('');
    await sendMessage(text);
  }, [messageText, isSending, sendMessage]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await mediaService.uploadMedia(file, currentUser.id);
      if (result.success && result.url) {
        await sendMessage(result.url, 'image');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getSenderName = (senderId: string) => {
    if (senderId === currentUser.id) return 'You';
    const profile = memberProfiles[senderId];
    return profile?.full_name?.split(' ')[0] || 'Unknown';
  };

  const getSenderAvatar = (senderId: string) => {
    const profile = memberProfiles[senderId];
    return profile?.avatar_url;
  };

  // Message Action Handlers
  const handleMessageLongPress = useCallback((message: GroupMessageWithStatus, position: { x: number; y: number }) => {
    setSelectedMessage(message);
    setActionMenuPosition(position);
  }, []);

  const handleCloseActionMenu = useCallback(() => {
    setSelectedMessage(null);
  }, []);

  const handleReactionClick = useCallback(async (messageId: string, emoji: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const userReacted = message.reactions?.[emoji]?.includes(currentUser.id);
    try {
      if (userReacted) {
        await groupService.removeReaction(messageId, currentUser.id, emoji);
      } else {
        await groupService.addReaction(messageId, currentUser.id, emoji);
      }
    } catch (error) {
      console.error('Failed to toggle reaction:', error);
    }
  }, [messages, currentUser.id]);

  const handleMessageDeleted = useCallback((_messageId: string, _forEveryone: boolean) => {
    // The message will be updated via realtime subscription
  }, []);

  const handleReplyMessage = useCallback((message: GroupMessageWithStatus) => {
    setReplyToMessage(message);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyToMessage(null);
  }, []);

  // Touch handlers for long press
  const handleTouchStart = (e: React.TouchEvent, message: GroupMessageWithStatus) => {
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = setTimeout(() => {
      handleMessageLongPress(message, { x: touch.clientX, y: touch.clientY });
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent, message: GroupMessageWithStatus) => {
    e.preventDefault();
    handleMessageLongPress(message, { x: e.clientX, y: e.clientY });
  };

  const renderMessage = (message: GroupMessageWithStatus, index: number) => {
    const isOwn = message.sender_id === currentUser.id;
    const isImage = message.type === 'image' && !!message.content;
    const showDate = index === 0 ||
      formatDate(messages[index - 1].created_at) !== formatDate(message.created_at);
    const showSender = !isOwn && (index === 0 || messages[index - 1].sender_id !== message.sender_id);

    // Check if message is deleted
    if (message.is_deleted) {
      return (
        <div key={message.id || message.client_message_id}>
          {showDate && (
            <div className="flex justify-center my-4">
              <span className="px-3 py-1 rounded-full bg-white/70 backdrop-blur-sm text-[10px] text-slate-500 font-medium shadow-sm">
                {formatDate(message.created_at)}
              </span>
            </div>
          )}
          <div className={`flex mb-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            {!isOwn && showSender && <div className="w-8 h-8 mr-2" />}
            {!isOwn && !showSender && <div className="w-8 mr-2" />}
            <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
              isOwn
                ? 'bg-gradient-to-r from-violet-400/50 to-purple-400/50 text-white/70 rounded-tr-sm'
                : 'bg-slate-100 text-slate-400 rounded-tl-sm'
            }`}>
              <p className="text-sm italic flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" />
                This message was deleted
              </p>
              <div className={`flex items-center justify-end gap-1 mt-0.5 ${isOwn ? 'text-white/50' : 'text-slate-300'}`}>
                <span className="text-[10px]">{formatTime(message.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={message.id || message.client_message_id}>
        {showDate && (
          <div className="flex justify-center my-4">
            <span className="px-3 py-1 rounded-full bg-white/70 backdrop-blur-sm text-[10px] text-slate-500 font-medium shadow-sm">
              {formatDate(message.created_at)}
            </span>
          </div>
        )}

        <div className={`flex mb-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
          {!isOwn && showSender && (
            <div className="w-8 h-8 rounded-full flex-shrink-0 mr-2 overflow-hidden bg-gradient-to-br from-violet-400 to-purple-400 flex items-center justify-center">
              {getSenderAvatar(message.sender_id) ? (
                <img
                  src={getSenderAvatar(message.sender_id)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-white text-xs font-bold">
                  {getSenderName(message.sender_id).charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          )}
          {!isOwn && !showSender && <div className="w-8 mr-2" />}

          <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
            {!isOwn && showSender && (
              <p className="text-[10px] text-violet-600 font-semibold mb-0.5 ml-1">
                {getSenderName(message.sender_id)}
              </p>
            )}

            {isImage ? (
              <>
                {/* Edge-to-edge media bubble (no px-3.5 py-2 text padding) —
                    matches the 1:1 chat's photo bubbles: the image fills the
                    whole rounded shape instead of sitting inside a visible
                    margin of solid bubble color, with the timestamp overlaid
                    directly on the image's own corner, WhatsApp-style. */}
                <div
                  className={`relative rounded-2xl overflow-hidden shadow-sm select-none ${
                    isOwn ? 'rounded-tr-sm' : 'rounded-tl-sm'
                  }`}
                  onTouchStart={(e) => handleTouchStart(e, message)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onContextMenu={(e) => handleContextMenu(e, message)}
                >
                  <img
                    src={message.content}
                    alt="Shared image"
                    className="block max-w-full max-h-[300px] object-cover"
                    loading="lazy"
                  />
                  <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full bg-black/45 text-[10px] text-white leading-none">
                    <span>{formatTime(message.created_at)}</span>
                    {message.is_edited && <span className="italic">edited</span>}
                    {isOwn && (
                      <>
                        {message.syncStatus === 'pending' && <Clock className="w-3 h-3 opacity-70" />}
                        {message.syncStatus === 'sent' && <Check className="w-3 h-3" />}
                        {(!message.syncStatus || message.syncStatus === 'sent') && message.is_read && (
                          <CheckCheck className="w-3 h-3" />
                        )}
                        {message.syncStatus === 'failed' && <X className="w-3 h-3 text-red-400" />}
                      </>
                    )}
                  </div>
                </div>
                {/* Kept outside the rounded/clipped image box above so the
                    reaction pills never get clipped by its corner rounding. */}
                <GroupReactionsDisplay
                  reactions={message.reactions}
                  currentUserId={currentUser.id}
                  onReactionClick={(emoji) => handleReactionClick(message.id, emoji)}
                />
              </>
            ) : (
              <div
                className={`rounded-2xl px-3.5 py-2 shadow-sm select-none ${
                  isOwn
                    ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-tr-sm'
                    : 'bg-white/90 text-slate-800 rounded-tl-sm border border-white/70'
                }`}
                onTouchStart={(e) => handleTouchStart(e, message)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onContextMenu={(e) => handleContextMenu(e, message)}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>

                <div className={`flex items-center justify-end gap-1 mt-0.5 ${isOwn ? 'text-white/70' : 'text-slate-400'}`}>
                  <span className="text-[10px]">{formatTime(message.created_at)}</span>
                  {message.is_edited && <span className="text-[10px] italic">edited</span>}
                  {isOwn && (
                    <>
                      {message.syncStatus === 'pending' && <Clock className="w-3 h-3 opacity-70" />}
                      {message.syncStatus === 'sent' && <Check className="w-3 h-3" />}
                      {(!message.syncStatus || message.syncStatus === 'sent') && message.is_read && (
                        <CheckCheck className="w-3 h-3" />
                      )}
                      {message.syncStatus === 'failed' && <X className="w-3 h-3 text-red-400" />}
                    </>
                  )}
                </div>

                {/* Reactions Display */}
                <GroupReactionsDisplay
                  reactions={message.reactions}
                  currentUserId={currentUser.id}
                  onReactionClick={(emoji) => handleReactionClick(message.id, emoji)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50">
      {/* Header */}
      <div className="relative z-20 backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-3 py-3 shadow-xl shadow-purple-500/20">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl hover:bg-white/20 transition-all duration-300 active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
          </button>

          <button
            type="button"
            className="flex-1 flex items-center gap-3 text-left min-w-0"
            onClick={onManageGroup}
            aria-label="Open group info"
          >
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-white/20 flex items-center justify-center">
              {group.avatar_url ? (
                <img src={group.avatar_url} alt={group.name} className="w-full h-full object-cover" />
              ) : (
                <Users className="w-5 h-5 text-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-sm truncate">{group.name}</h2>
              <p className="text-xs text-white/70 truncate">
                {members.length} members
                {!isOnline && ' • Offline'}
              </p>
            </div>
          </button>

          <div className="flex items-center gap-1">
            {onGroupCall && (
              <>
                <button
                  onClick={() => onGroupCall('voice')}
                  className="p-2 rounded-xl hover:bg-white/20 transition-all duration-300 active:scale-95"
                  aria-label="Voice call"
                >
                  <Phone className="w-5 h-5" strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => onGroupCall('video')}
                  className="p-2 rounded-xl hover:bg-white/20 transition-all duration-300 active:scale-95"
                  aria-label="Video call"
                >
                  <Video className="w-5 h-5" strokeWidth={2.5} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {isLoading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-400 flex items-center justify-center mb-4 animate-pulse">
              <Users className="w-8 h-8 text-white" />
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-400 flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-white" />
            </div>
            <p className="text-sm text-slate-600 font-medium">No messages yet</p>
            <p className="text-xs text-slate-500">Start the conversation!</p>
          </div>
        ) : (
          <>
            {hasMore && (
              <button
                onClick={loadMoreMessages}
                className="w-full py-2 text-xs text-violet-600 hover:text-violet-700 font-medium"
              >
                Load earlier messages
              </button>
            )}
            {messages.map((message, index) => renderMessage(message, index))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-4 py-2 bg-red-100 border-t border-red-200">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Input Area */}
      <div className="backdrop-blur-2xl bg-white/70 border-t border-white/70 px-3 py-2.5 shadow-lg">
        {/* Reply Preview */}
        {replyToMessage && (
          <div className="mb-2 bg-white/90 backdrop-blur-sm rounded-xl px-3 py-2 flex items-start gap-2 border-l-4 border-violet-500">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-violet-600">
                Replying to {replyToMessage.sender_id === currentUser.id ? 'yourself' : getSenderName(replyToMessage.sender_id)}
              </p>
              <p className="text-sm text-slate-600 truncate">
                {replyToMessage.type === 'text' || !replyToMessage.type ? replyToMessage.content : `[${replyToMessage.type}]`}
              </p>
            </div>
            <button
              onClick={cancelReply}
              className="p-1 rounded-full hover:bg-slate-100"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex items-center gap-1">
            <label className="p-2 rounded-xl text-violet-600 hover:bg-violet-100 transition-all cursor-pointer">
              <Image className="w-5 h-5" strokeWidth={2} />
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
            <button className="p-2 rounded-xl text-violet-600 hover:bg-violet-100 transition-all">
              <Paperclip className="w-5 h-5" strokeWidth={2} />
            </button>
          </div>

          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyPress={handleKeyPress}
              onFocus={() => {
                // Same keyboard-covers-the-input fallback as the 1:1 chat
                // input — see ChatView's handleInputFocus for why this is
                // needed even with the app shell's own viewport resize fix.
                setTimeout(() => {
                  inputRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
                }, 300);
              }}
              placeholder="Type a message..."
              rows={1}
              className="w-full px-4 py-2.5 rounded-2xl bg-white border border-slate-200 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-300 transition-all"
              style={{ maxHeight: '120px' }}
            />
          </div>

          <div className="flex items-center gap-1">
            <button className="p-2 rounded-xl text-violet-600 hover:bg-violet-100 transition-all">
              <Smile className="w-5 h-5" strokeWidth={2} />
            </button>

            {messageText.trim() ? (
              <button
                onClick={handleSendMessage}
                disabled={isSending}
                className="p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-lg shadow-purple-500/30 hover:shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                <Send className={`w-5 h-5 transition-opacity ${isSending ? 'opacity-50' : ''}`} strokeWidth={2.5} />
              </button>
            ) : (
              <button className="p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-lg shadow-purple-500/30">
                <Mic className="w-5 h-5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Message Actions Menu */}
      {selectedMessage && (
        <GroupMessageActions
          message={selectedMessage as GroupMessage}
          isOwn={selectedMessage.sender_id === currentUser.id}
          currentUserId={currentUser.id}
          onClose={handleCloseActionMenu}
          onMessageDeleted={handleMessageDeleted}
          onReply={handleReplyMessage}
          position={actionMenuPosition}
        />
      )}

      {/* Animation Styles */}
      <style>{`
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in {
          animation: scale-in 0.25s ease-out;
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(100%); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-down {
          animation: slide-down 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}
