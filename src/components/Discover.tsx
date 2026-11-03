/**
 * Discover Component - Combined Friends + Discover
 *
 * Sub-tabs:
 * - Friends: View and manage your friends list
 * - Requests: View and respond to friend requests
 * - Find: Search and discover new people
 */

import { useState } from 'react';
import {
  Search,
  UserPlus,
  UserCheck,
  Sparkles,
  X,
  Check,
  UserMinus,
  MessageCircle,
  Phone,
  Video,
  Users
} from 'lucide-react';
import { friendService } from '../services/friendService';
import { presenceStatusText } from '../utils/presenceFormat';
import { UserProfile, FriendRequest, Contact } from '../types';

interface Friend {
  id: string;
  profile: UserProfile;
}

interface Suggestion {
  id: string;
  profile: UserProfile;
  isFriend: boolean;
}

interface DiscoverProps {
  currentUser: UserProfile;
  friends: Friend[];
  requests: FriendRequest[];
  suggestions: Suggestion[];
  sentRequestIds: Set<string>;
  onAddFriend: (userId: string) => void;
  onRefresh: () => void;
  onMessage: (contact: Contact) => void;
  onCall: (userId: string, type: 'voice' | 'video') => void;
  onViewProfile?: (userId: string, initialProfile?: UserProfile) => void;
}

type DiscoverTab = 'friends' | 'requests' | 'find';

export function Discover({
  currentUser,
  friends,
  requests,
  suggestions,
  sentRequestIds,
  onAddFriend,
  onRefresh,
  onMessage,
  onCall,
  onViewProfile
}: DiscoverProps) {
  const [activeTab, setActiveTab] = useState<DiscoverTab>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);
  const [localRequests, setLocalRequests] = useState<FriendRequest[]>(requests);
  const [unfriendingUser, setUnfriendingUser] = useState<string | null>(null);
  const [confirmUnfriend, setConfirmUnfriend] = useState<{ id: string; name: string } | null>(null);
  const [cancelingRequest, setCancelingRequest] = useState<string | null>(null);
  const [localSentRequestIds, setLocalSentRequestIds] = useState<Set<string>>(sentRequestIds);

  // Update local sent request IDs when prop changes
  if (sentRequestIds !== localSentRequestIds && sentRequestIds.size !== localSentRequestIds.size) {
    setLocalSentRequestIds(sentRequestIds);
  }

  // Update local requests when prop changes
  if (requests !== localRequests && requests.length !== localRequests.length) {
    setLocalRequests(requests);
  }

  // Friends tab handlers
  const handleMessage = (friend: Friend) => {
    onMessage({
      user_id: friend.id,
      status: 'accepted',
      profile: friend.profile
    });
  };

  const filteredFriends = friends.filter((friend) =>
    friend.profile.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.profile.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Request handlers
  const handleAccept = async (request: FriendRequest) => {
    setProcessingRequest(request.id);
    try {
      await friendService.acceptRequest(request.sender_id, currentUser.id);
      setLocalRequests(prev => prev.filter(r => r.id !== request.id));
      onRefresh();
    } catch (error) {
      console.error('Error accepting request:', error);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleReject = async (request: FriendRequest) => {
    setProcessingRequest(request.id);
    try {
      await friendService.declineRequest(request.sender_id, currentUser.id);
      setLocalRequests(prev => prev.filter(r => r.id !== request.id));
      onRefresh();
    } catch (error) {
      console.error('Error rejecting request:', error);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleAddFriend = async (userId: string) => {
    const newSentIds = new Set(localSentRequestIds);
    newSentIds.add(userId);
    setLocalSentRequestIds(newSentIds);
    onAddFriend(userId);
    try {
      await friendService.sendRequest(currentUser.id, userId);
    } catch (error) {
      console.error('Error sending friend request:', error);
      const revertedIds = new Set(localSentRequestIds);
      revertedIds.delete(userId);
      setLocalSentRequestIds(revertedIds);
    }
  };

  const handleCancelRequest = async (userId: string) => {
    setCancelingRequest(userId);
    try {
      await friendService.cancelRequest(currentUser.id, userId);
      const newSentIds = new Set(localSentRequestIds);
      newSentIds.delete(userId);
      setLocalSentRequestIds(newSentIds);
      onRefresh();
    } catch (error) {
      console.error('Error canceling friend request:', error);
    } finally {
      setCancelingRequest(null);
    }
  };

  const handleUnfriendClick = (userId: string, userName: string) => {
    setConfirmUnfriend({ id: userId, name: userName });
  };

  const handleConfirmUnfriend = async () => {
    if (!confirmUnfriend) return;

    setUnfriendingUser(confirmUnfriend.id);
    setConfirmUnfriend(null);

    try {
      await friendService.removeFriend(currentUser.id, confirmUnfriend.id);
      onRefresh();
    } catch (error) {
      console.error('Error unfriending user:', error);
    } finally {
      setUnfriendingUser(null);
    }
  };

  const handleCancelUnfriend = () => {
    setConfirmUnfriend(null);
  };

  const filteredSuggestions = suggestions.filter(
    (user) =>
      user.profile.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.profile.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const renderActionButton = (user: Suggestion) => {
    if (user.isFriend) {
      return (
        <button
          onClick={() => handleUnfriendClick(user.id, user.profile.full_name)}
          disabled={unfriendingUser === user.id}
          className="flex items-center gap-1.5 px-3.5 py-2 backdrop-blur-lg bg-green-100/80 text-green-700 rounded-xl text-xs font-bold border border-green-300/60 shadow-sm flex-shrink-0 hover:bg-red-100/80 hover:text-red-600 hover:border-red-300/60 transition-all duration-300"
        >
          <UserCheck className={`w-3.5 h-3.5 ${unfriendingUser === user.id ? 'opacity-50' : ''}`} strokeWidth={2.5} />
          <span>{unfriendingUser === user.id ? '...' : 'Friends'}</span>
        </button>
      );
    } else if (localSentRequestIds.has(user.id)) {
      return (
        <button
          onClick={() => handleCancelRequest(user.id)}
          disabled={cancelingRequest === user.id}
          className="flex items-center gap-1.5 px-3.5 py-2 backdrop-blur-lg bg-amber-100/80 text-amber-700 rounded-xl text-xs font-bold border border-amber-300/60 shadow-sm flex-shrink-0 hover:bg-red-100/80 hover:text-red-600 hover:border-red-300/60 transition-all duration-300"
        >
          <X className={`w-3.5 h-3.5 ${cancelingRequest === user.id ? 'opacity-50' : ''}`} strokeWidth={2.5} />
          <span>{cancelingRequest === user.id ? '...' : 'Cancel'}</span>
        </button>
      );
    } else {
      return (
        <button
          onClick={() => handleAddFriend(user.id)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white rounded-xl text-xs font-bold hover:shadow-lg hover:shadow-violet-500/40 transition-all duration-300 hover:scale-110 active:scale-95 flex-shrink-0"
        >
          <UserPlus className="w-3.5 h-3.5" strokeWidth={2.5} />
          <span>Add</span>
        </button>
      );
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-4 py-3.5 shadow-xl shadow-purple-500/20">
        <h1 className="text-xl font-bold mb-3 tracking-tight flex items-center gap-2">
          <Sparkles className="w-5 h-5" strokeWidth={2.5} />
          Discover
        </h1>

        {/* Sub Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('friends')}
            className={`flex-1 py-2.5 rounded-xl transition-all duration-300 transform ${
              activeTab === 'friends'
                ? 'bg-white text-violet-600 shadow-lg shadow-white/15 scale-105'
                : 'bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 border border-white/20 active:scale-95'
            }`}
          >
            <div className="flex items-center justify-center gap-2 text-xs font-bold">
              <Users className="w-4 h-4" strokeWidth={2.5} />
              <span>Friends</span>
              {friends.length > 0 && (
                <span className={`text-[9px] rounded-full px-2 py-0.5 font-bold ${
                  activeTab === 'friends'
                    ? 'bg-violet-100 text-violet-600'
                    : 'bg-white/20 text-white'
                }`}>
                  {friends.length}
                </span>
              )}
            </div>
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`flex-1 py-2.5 rounded-xl transition-all duration-300 transform ${
              activeTab === 'requests'
                ? 'bg-white text-violet-600 shadow-lg shadow-white/15 scale-105'
                : 'bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 border border-white/20 active:scale-95'
            }`}
          >
            <div className="flex items-center justify-center gap-2 text-xs font-bold">
              <UserPlus className="w-4 h-4" strokeWidth={2.5} />
              <span>Requests</span>
              {localRequests.length > 0 && (
                <span
                  className={`text-[9px] rounded-full px-2 py-0.5 font-bold shadow-md ${
                    activeTab === 'requests'
                      ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white'
                      : 'bg-gradient-to-r from-pink-500 to-rose-500 text-white animate-pulse'
                  }`}
                >
                  {localRequests.length}
                </span>
              )}
            </div>
          </button>
          <button
            onClick={() => setActiveTab('find')}
            className={`flex-1 py-2.5 rounded-xl transition-all duration-300 transform ${
              activeTab === 'find'
                ? 'bg-white text-violet-600 shadow-lg shadow-white/15 scale-105'
                : 'bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 border border-white/20 active:scale-95'
            }`}
          >
            <div className="flex items-center justify-center gap-2 text-xs font-bold">
              <Search className="w-4 h-4" strokeWidth={2.5} />
              <span>Find</span>
            </div>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {/* FRIENDS TAB */}
        {activeTab === 'friends' && (
          <div>
            {/* Search Bar */}
            <div className="mb-3">
              <div className="relative group">
                <Search
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400 transition-all duration-300 group-focus-within:text-violet-600"
                  strokeWidth={2.5}
                />
                <input
                  type="text"
                  placeholder="Search friends..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-sm rounded-xl backdrop-blur-xl bg-white/85 border border-white/70 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 text-slate-800 placeholder-slate-400 transition-all duration-300 shadow-sm"
                />
              </div>
            </div>

            {filteredFriends.length === 0 ? (
              <div className="glass-card flex flex-col items-center justify-center h-64 rounded-2xl p-8">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center text-3xl mb-4 shadow-lg shadow-purple-500/30">
                  👥
                </div>
                <p className="text-sm text-slate-600 font-medium mb-1">
                  {searchQuery ? 'No friends found' : 'No friends yet'}
                </p>
                <p className="text-xs text-slate-500 text-center">
                  {searchQuery ? 'Try a different search' : 'Add friends to start chatting'}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredFriends.map((friend, index) => (
                  <div
                    key={friend.id}
                    style={{ animationDelay: `${index * 30}ms` }}
                    className="flex items-center gap-3 p-3 rounded-2xl backdrop-blur-xl bg-white/70 border border-white/70 hover:bg-white/90 hover:shadow-lg hover:shadow-purple-500/15 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] animate-slide-up group"
                  >
                    <button
                      onClick={() => onViewProfile?.(friend.id, friend.profile)}
                      disabled={!onViewProfile}
                      className="relative disabled:cursor-default"
                      aria-label="View profile"
                    >
                      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center text-xl flex-shrink-0 shadow-md shadow-purple-500/20 group-hover:scale-105 transition-transform duration-300 overflow-hidden">
                        {friend.profile.avatar_url ? (
                          <img src={friend.profile.avatar_url} alt={friend.profile.full_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-white font-semibold">{friend.profile.full_name.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      {friend.profile.is_online && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-md"></div>
                      )}
                    </button>

                    <button
                      onClick={() => onViewProfile?.(friend.id, friend.profile)}
                      disabled={!onViewProfile}
                      className="flex-1 min-w-0 text-left disabled:cursor-default"
                    >
                      <h3 className="text-sm font-semibold text-slate-800 group-hover:text-violet-600 transition-colors truncate">
                        {friend.profile.full_name}
                      </h3>
                      <p className="text-xs text-slate-500 truncate">@{friend.profile.username || 'user'}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {friend.profile.is_online ? (
                          <span className="text-green-600 font-medium">Online</span>
                        ) : (
                          presenceStatusText(friend.profile.is_online, friend.profile.last_seen)
                        )}
                      </p>
                    </button>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleMessage(friend)}
                        className="text-violet-600 hover:bg-gradient-to-r hover:from-violet-500 hover:to-purple-500 hover:text-white p-2 rounded-xl transition-all duration-300 hover:scale-110 active:scale-95 hover:shadow-md hover:shadow-violet-500/30"
                        aria-label="Message"
                      >
                        <MessageCircle className="w-4 h-4" strokeWidth={2.5} />
                      </button>
                      <button
                        onClick={() => onCall(friend.id, 'voice')}
                        className="text-violet-600 hover:bg-gradient-to-r hover:from-violet-500 hover:to-purple-500 hover:text-white p-2 rounded-xl transition-all duration-300 hover:scale-110 active:scale-95 hover:shadow-md hover:shadow-violet-500/30"
                        aria-label="Voice call"
                      >
                        <Phone className="w-4 h-4" strokeWidth={2.5} />
                      </button>
                      <button
                        onClick={() => onCall(friend.id, 'video')}
                        className="text-violet-600 hover:bg-gradient-to-r hover:from-violet-500 hover:to-purple-500 hover:text-white p-2 rounded-xl transition-all duration-300 hover:scale-110 active:scale-95 hover:shadow-md hover:shadow-violet-500/30"
                        aria-label="Video call"
                      >
                        <Video className="w-4 h-4" strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* REQUESTS TAB */}
        {activeTab === 'requests' && (
          <div>
            {localRequests.length > 0 ? (
              <div className="space-y-2.5">
                {localRequests.map((request, index) => (
                  <div
                    key={request.id}
                    style={{ animationDelay: `${index * 50}ms` }}
                    className="p-3.5 rounded-2xl backdrop-blur-xl bg-white/70 border border-white/70 hover:bg-white/90 hover:shadow-lg hover:shadow-purple-500/15 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] animate-slide-up"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <button
                        onClick={() => request.sender_profile && onViewProfile?.(request.sender_id, request.sender_profile)}
                        disabled={!onViewProfile || !request.sender_profile}
                        className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center text-xl flex-shrink-0 shadow-md shadow-purple-500/20 overflow-hidden disabled:cursor-default"
                        aria-label="View profile"
                      >
                        {request.sender_profile?.avatar_url ? (
                          <img
                            src={request.sender_profile.avatar_url}
                            alt={request.sender_profile.full_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-white font-semibold">
                            {request.sender_profile?.full_name?.charAt(0).toUpperCase() || '?'}
                          </span>
                        )}
                      </button>

                      <button
                        onClick={() => request.sender_profile && onViewProfile?.(request.sender_id, request.sender_profile)}
                        disabled={!onViewProfile || !request.sender_profile}
                        className="flex-1 min-w-0 text-left disabled:cursor-default"
                      >
                        <h3 className="text-sm font-semibold text-slate-800 truncate">
                          {request.sender_profile?.full_name || 'Unknown'}
                        </h3>
                        <p className="text-[11px] text-violet-600 font-medium">
                          @{request.sender_profile?.username || 'user'}
                        </p>
                        <p className="text-[10px] text-slate-500 font-medium">
                          {formatTime(request.created_at)}
                        </p>
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAccept(request)}
                        disabled={processingRequest === request.id}
                        className="flex-1 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white py-2.5 rounded-xl text-xs font-bold hover:shadow-lg hover:shadow-violet-500/40 transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-70 flex items-center justify-center gap-1"
                      >
                        <Check className={`w-4 h-4 ${processingRequest === request.id ? 'opacity-50' : ''}`} />
                        {processingRequest === request.id ? '...' : 'Accept'}
                      </button>
                      <button
                        onClick={() => handleReject(request)}
                        disabled={processingRequest === request.id}
                        className="flex-1 backdrop-blur-lg bg-slate-200/80 text-slate-700 py-2.5 rounded-xl text-xs font-bold hover:bg-slate-300/80 transition-all duration-300 hover:scale-105 active:scale-95 border border-slate-300/60 disabled:opacity-70 flex items-center justify-center gap-1"
                      >
                        <X className="w-4 h-4" />
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-card flex flex-col items-center justify-center h-64 rounded-2xl p-8">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center text-3xl mb-4 shadow-lg shadow-purple-500/30">
                  📬
                </div>
                <p className="text-sm text-slate-600 font-medium mb-1">No pending requests</p>
                <p className="text-xs text-slate-500 text-center">Friend requests will appear here</p>
              </div>
            )}
          </div>
        )}

        {/* FIND TAB */}
        {activeTab === 'find' && (
          <div>
            {/* Search Bar */}
            <div className="mb-3">
              <div className="relative group">
                <Search
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400 transition-all duration-300 group-focus-within:text-violet-600"
                  strokeWidth={2.5}
                />
                <input
                  type="text"
                  placeholder="Search people..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-sm rounded-xl backdrop-blur-xl bg-white/85 border border-white/70 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 text-slate-800 placeholder-slate-400 transition-all duration-300 shadow-sm"
                />
              </div>
            </div>

            {/* All Users */}
            {filteredSuggestions.length > 0 ? (
              <>
                <div className="mb-2.5 px-1">
                  <span className="text-[11px] font-bold text-violet-700 bg-violet-100/80 px-3.5 py-1.5 rounded-full border border-violet-200/60 shadow-sm">
                    All Users
                  </span>
                </div>

                <div className="space-y-2.5">
                  {filteredSuggestions.map((user, index) => (
                    <div
                      key={user.id}
                      style={{ animationDelay: `${index * 30}ms` }}
                      className="p-3.5 rounded-2xl backdrop-blur-xl bg-white/70 border border-white/70 hover:bg-white/90 hover:shadow-lg hover:shadow-purple-500/15 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] animate-slide-up group"
                    >
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => onViewProfile?.(user.id, user.profile)}
                          disabled={!onViewProfile}
                          className="relative disabled:cursor-default"
                          aria-label="View profile"
                        >
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center text-xl flex-shrink-0 shadow-md shadow-purple-500/20 group-hover:scale-105 transition-transform duration-300 overflow-hidden">
                            {user.profile.avatar_url ? (
                              <img
                                src={user.profile.avatar_url}
                                alt={user.profile.full_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-white font-semibold">
                                {user.profile.full_name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          {user.profile.is_online && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white shadow-sm"></div>
                          )}
                        </button>

                        <button
                          onClick={() => onViewProfile?.(user.id, user.profile)}
                          disabled={!onViewProfile}
                          className="flex-1 min-w-0 text-left disabled:cursor-default"
                        >
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-800 group-hover:text-violet-600 transition-colors duration-300 truncate">
                              {user.profile.full_name}
                            </h3>
                            {user.isFriend && (
                              <span className="text-[9px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full">
                                Friend
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600 truncate">
                            @{user.profile.username || 'user'}
                          </p>
                        </button>

                        {renderActionButton(user)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="glass-card flex flex-col items-center justify-center h-64 rounded-2xl p-8">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center text-3xl mb-4 shadow-lg shadow-purple-500/30">
                  🔍
                </div>
                <p className="text-sm text-slate-600 font-medium mb-1">
                  {searchQuery ? 'No users found' : 'No users yet'}
                </p>
                <p className="text-xs text-slate-500 text-center">
                  {searchQuery ? 'Try a different search' : 'Check back later for new people'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Unfriend Confirmation Modal */}
      {confirmUnfriend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="glass-card rounded-2xl p-6 max-w-sm w-full animate-scale-in">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <UserMinus className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">Unfriend {confirmUnfriend.name}?</h3>
              <p className="text-sm text-slate-500 mb-6">
                Are you sure you want to remove {confirmUnfriend.name} from your friends? You can always add them back later.
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={handleCancelUnfriend}
                  className="flex-1 py-3 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmUnfriend}
                  className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-semibold text-sm hover:bg-red-600 transition-colors"
                >
                  Unfriend
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Animation Styles */}
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
        .animate-scale-in {
          animation: scale-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
