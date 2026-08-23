import { useState, useEffect } from 'react';
import { ArrowLeft, Camera, Check, Search, Users, X } from 'lucide-react';
import { groupService } from '../services/groupService';
import { friendService } from '../services/friendService';
import { UserProfile } from '../types';

interface CreateGroupProps {
  currentUser: UserProfile;
  onBack: () => void;
  onGroupCreated: (groupId: string) => void;
}

interface FriendItem {
  id: string;
  profile: UserProfile;
  selected: boolean;
}

export function CreateGroup({ currentUser, onBack, onGroupCreated }: CreateGroupProps) {
  const [step, setStep] = useState<'select' | 'details'>('select');
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupAvatar, setGroupAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Load friends list
  useEffect(() => {
    const loadFriends = async () => {
      try {
        const result = await friendService.getFriends(currentUser.id);
        if (result.success && result.data) {
          setFriends(
            result.data.friends.map((profile) => ({
              id: profile.id,
              profile: profile,
              selected: false
            }))
          );
        }
      } catch (error) {
        console.error('Error loading friends:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFriends();
  }, [currentUser.id]);

  const selectedFriends = friends.filter(f => f.selected);
  const filteredFriends = friends.filter(f =>
    f.profile.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.profile.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleFriendSelection = (id: string) => {
    setFriends(prev =>
      prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f)
    );
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setGroupAvatar(file);
      const reader = new FileReader();
      reader.onload = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleContinue = () => {
    if (selectedFriends.length === 0) {
      setError('Select at least one friend');
      return;
    }
    setError('');
    setStep('details');
  };

  const handleCreate = async () => {
    if (!groupName.trim()) {
      setError('Group name is required');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const result = await groupService.createGroup({
        name: groupName.trim(),
        description: groupDescription.trim() || undefined,
        avatarFile: groupAvatar || undefined,
        createdBy: currentUser.id,
        memberIds: selectedFriends.map(f => f.id)
      });

      if (result.success && result.data) {
        onGroupCreated(result.data.group.id);
      } else {
        setError(result.error || 'Failed to create group');
      }
    } catch (error) {
      console.error('Error creating group:', error);
      setError('An error occurred. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50">
      {/* Header */}
      <div className="backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-3 py-3.5 shadow-xl shadow-purple-500/20">
        <div className="flex items-center gap-3">
          <button
            onClick={step === 'details' ? () => setStep('select') : onBack}
            className="p-2 rounded-xl hover:bg-white/20 transition-all duration-300 active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
          </button>
          <h1 className="text-lg font-bold flex-1">
            {step === 'select' ? 'Add Participants' : 'New Group'}
          </h1>
          {step === 'select' && selectedFriends.length > 0 && (
            <button
              onClick={handleContinue}
              className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-sm font-semibold transition-all"
            >
              Next
            </button>
          )}
        </div>

        {/* Search (only on select step) */}
        {step === 'select' && (
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/70" strokeWidth={2.5} />
            <input
              type="text"
              placeholder="Search friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 text-white placeholder-white/60 text-sm focus:outline-none focus:ring-2 focus:ring-white/40"
            />
          </div>
        )}
      </div>

      {/* Selected Friends Preview */}
      {step === 'select' && selectedFriends.length > 0 && (
        <div className="bg-white/70 backdrop-blur-xl border-b border-white/70 px-4 py-3">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {selectedFriends.map((friend) => (
              <div key={friend.id} className="flex flex-col items-center flex-shrink-0 relative">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-violet-400 to-purple-400">
                  {friend.profile.avatar_url ? (
                    <img src={friend.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white font-bold">
                      {friend.profile.full_name?.charAt(0) || '?'}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => toggleFriendSelection(friend.id)}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-600 text-white flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
                <p className="text-[10px] text-slate-600 mt-1 text-center max-w-[50px] truncate">
                  {friend.profile.full_name?.split(' ')[0]}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {step === 'select' ? (
          // Friend Selection
          <>
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-400 flex items-center justify-center animate-pulse">
                  <Users className="w-8 h-8 text-white" />
                </div>
              </div>
            ) : filteredFriends.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Users className="w-16 h-16 text-slate-300 mb-4" />
                <p className="text-sm text-slate-600 font-medium">
                  {searchQuery ? 'No friends found' : 'No friends yet'}
                </p>
                <p className="text-xs text-slate-500 text-center">
                  {searchQuery ? 'Try a different search' : 'Add friends to create a group'}
                </p>
              </div>
            ) : (
              filteredFriends.map((friend) => (
                <button
                  key={friend.id}
                  onClick={() => toggleFriendSelection(friend.id)}
                  className={`w-full flex items-center gap-3 p-3 mb-2 rounded-2xl transition-all duration-300 ${
                    friend.selected
                      ? 'bg-violet-100 border-2 border-violet-400'
                      : 'bg-white/70 border border-white/70 hover:bg-white/90'
                  }`}
                >
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-violet-400 to-purple-400">
                      {friend.profile.avatar_url ? (
                        <img src={friend.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white font-bold">
                          {friend.profile.full_name?.charAt(0) || '?'}
                        </div>
                      )}
                    </div>
                    {friend.selected && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <h3 className="text-sm font-semibold text-slate-800">{friend.profile.full_name}</h3>
                    {friend.profile.username && (
                      <p className="text-xs text-slate-500">@{friend.profile.username}</p>
                    )}
                  </div>
                </button>
              ))
            )}
          </>
        ) : (
          // Group Details
          <div className="space-y-6">
            {/* Avatar */}
            <div className="flex justify-center">
              <label className="relative cursor-pointer group">
                <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center shadow-lg shadow-purple-500/30 group-hover:shadow-xl transition-all">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Group avatar" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-10 h-10 text-white/80" />
                  )}
                </div>
                <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center shadow-lg">
                  <Camera className="w-4 h-4 text-white" />
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </label>
            </div>

            {/* Group Name */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Group Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter group name"
                maxLength={50}
                className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-300"
              />
              <p className="text-xs text-slate-500 mt-1 text-right">{groupName.length}/50</p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Description (Optional)
              </label>
              <textarea
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="What's this group about?"
                rows={3}
                maxLength={200}
                className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-300"
              />
              <p className="text-xs text-slate-500 mt-1 text-right">{groupDescription.length}/200</p>
            </div>

            {/* Participants Preview */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Participants ({selectedFriends.length + 1})
              </label>
              <div className="flex flex-wrap gap-2">
                {/* Current User */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-100 border border-violet-200">
                  <div className="w-6 h-6 rounded-full overflow-hidden bg-violet-400">
                    {currentUser.avatar_url ? (
                      <img src={currentUser.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                        {currentUser.full_name?.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-medium text-violet-700">You</span>
                </div>
                {/* Selected Friends */}
                {selectedFriends.map((friend) => (
                  <div
                    key={friend.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200"
                  >
                    <div className="w-6 h-6 rounded-full overflow-hidden bg-slate-400">
                      {friend.profile.avatar_url ? (
                        <img src={friend.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                          {friend.profile.full_name?.charAt(0)}
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-medium text-slate-700">
                      {friend.profile.full_name?.split(' ')[0]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-100 border border-red-200">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Create Button */}
            <button
              onClick={handleCreate}
              disabled={creating || !groupName.trim()}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white font-semibold shadow-lg shadow-purple-500/30 hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Users className={`w-5 h-5 ${creating ? 'opacity-50' : ''}`} />
              {creating ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        )}
      </div>

      {/* Error Banner (for select step) */}
      {step === 'select' && error && (
        <div className="px-4 py-3 bg-red-100 border-t border-red-200">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
