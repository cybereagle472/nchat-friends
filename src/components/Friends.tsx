import { Search, MessageCircle, Phone, Video } from 'lucide-react';
import { useState } from 'react';
import { UserProfile, Contact } from '../types';

interface Friend {
  id: string;
  profile: UserProfile;
}

interface FriendsProps {
  currentUser: UserProfile;
  friends: Friend[];
  onMessage: (contact: Contact) => void;
  onCall: (userId: string, type: 'voice' | 'video') => void;
}

export function Friends({ friends, onMessage, onCall }: FriendsProps) {
  const [searchQuery, setSearchQuery] = useState('');

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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-4 py-3.5 shadow-xl shadow-purple-500/20">
        <h1 className="text-xl font-bold mb-3 tracking-tight">Friends</h1>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/70" strokeWidth={2.5} />
          <input
            type="text"
            placeholder="Search friends..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 text-white placeholder-white/60 text-sm focus:outline-none focus:ring-2 focus:ring-white/40"
          />
        </div>
      </div>

      {/* Friends List */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {filteredFriends.length === 0 ? (
          <div className="glass-card flex flex-col items-center justify-center h-full rounded-2xl p-8">
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
          filteredFriends.map((friend, index) => (
            <div
              key={friend.id}
              style={{ animationDelay: `${index * 30}ms` }}
              className="flex items-center gap-3 p-3 mb-2 rounded-2xl backdrop-blur-xl bg-white/70 border border-white/70 hover:bg-white/90 hover:shadow-lg hover:shadow-purple-500/15 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] animate-slide-up group"
            >
              <div className="relative">
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
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-violet-600 transition-colors truncate">
                  {friend.profile.full_name}
                </h3>
                <p className="text-xs text-slate-500 truncate">@{friend.profile.username || 'user'}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {friend.profile.is_online ? (
                    <span className="text-green-600 font-medium">Online</span>
                  ) : (
                    friend.profile.last_seen ? `Last seen ${new Date(friend.profile.last_seen).toLocaleDateString()}` : 'Offline'
                  )}
                </p>
              </div>

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
          ))
        )}
      </div>
    </div>
  );
}
