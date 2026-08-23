import { useState } from 'react';
import { Users, Plus, Search, ChevronRight } from 'lucide-react';
import { GroupWithMembers } from '../services/groupService';
import { UserProfile } from '../types';

interface GroupsProps {
  currentUser: UserProfile;
  groups: GroupWithMembers[];
  onOpenGroup: (group: GroupWithMembers) => void;
  onCreateGroup: () => void;
}

export function Groups({ currentUser, groups, onOpenGroup, onCreateGroup }: GroupsProps) {
  const [searchQuery, setSearchQuery] = useState('');

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
          filteredGroups.map((group, index) => (
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
                    {group.lastMessage ? (
                      <>
                        <span className="font-medium text-slate-600">
                          {group.lastMessage.sender_id === currentUser.id
                            ? 'You'
                            : group.lastMessage.sender_profile?.full_name?.split(' ')[0] || 'Someone'}
                          :
                        </span>{' '}
                        {group.lastMessage.content || 'Sent a message'}
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
          ))
        )}
      </div>
    </div>
  );
}
