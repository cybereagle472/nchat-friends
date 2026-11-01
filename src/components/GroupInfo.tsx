import { useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Pencil,
  Check,
  Search,
  Users,
  UserPlus,
  Crown,
  MoreVertical,
  ShieldPlus,
  ShieldMinus,
  UserMinus,
  BellOff,
  Bell,
  LogOut,
  Trash2
} from 'lucide-react';
import { groupService, GroupWithMembers } from '../services/groupService';
import { UserProfile } from '../types';
import { Friend } from '../hooks/useAppData';
import { toast } from 'sonner';

interface GroupInfoProps {
  currentUser: UserProfile;
  group: GroupWithMembers;
  friends: Friend[];
  /** Called after any successful change — the caller re-fetches the group list/open group. */
  onChanged: () => void;
  /** Called after you leave or the group is deleted — navigate back out of it entirely. */
  onLeftOrDeleted: () => void;
  onBack: () => void;
  onViewProfile?: (userId: string, initialProfile?: UserProfile) => void;
}

export function GroupInfo({ currentUser, group, friends, onChanged, onLeftOrDeleted, onBack, onViewProfile }: GroupInfoProps) {
  const [view, setView] = useState<'info' | 'add-members'>('info');
  const [editingDetails, setEditingDetails] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);
  const [descriptionDraft, setDescriptionDraft] = useState(group.description || '');
  const [savingDetails, setSavingDetails] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [openMemberMenu, setOpenMemberMenu] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);

  const myMembership = group.members.find((m) => m.user_id === currentUser.id);
  const isAdmin = myMembership?.role === 'admin';
  const isMuted = !!myMembership?.is_muted;
  const adminCount = group.members.filter((m) => m.role === 'admin').length;

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const result = await groupService.updateGroup(group.id, currentUser.id, { avatarFile: file });
      if (result.success) {
        toast.success('Group photo updated');
        onChanged();
      } else {
        toast.error(result.error || 'Failed to update group photo');
      }
    } finally {
      setUploadingAvatar(false);
      e.target.value = '';
    }
  };

  const handleSaveDetails = async () => {
    if (!nameDraft.trim()) {
      toast.error('Group name is required');
      return;
    }
    setSavingDetails(true);
    try {
      const result = await groupService.updateGroup(group.id, currentUser.id, {
        name: nameDraft.trim(),
        description: descriptionDraft.trim()
      });
      if (result.success) {
        toast.success('Group updated');
        setEditingDetails(false);
        onChanged();
      } else {
        toast.error(result.error || 'Failed to update group');
      }
    } finally {
      setSavingDetails(false);
    }
  };

  const handleToggleMute = async () => {
    const next = !isMuted;
    const result = await groupService.toggleMute(group.id, currentUser.id, next);
    if (result.success) {
      toast.success(next ? 'Group muted' : 'Group unmuted');
      onChanged();
    } else {
      toast.error(result.error || 'Failed to update mute setting');
    }
  };

  const handlePromote = async (memberId: string) => {
    setBusyMemberId(memberId);
    setOpenMemberMenu(null);
    try {
      const result = await groupService.promoteMember(group.id, currentUser.id, memberId);
      if (result.success) {
        toast.success('Member promoted to admin');
        onChanged();
      } else {
        toast.error(result.error || 'Failed to promote member');
      }
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleDemote = async (memberId: string) => {
    setBusyMemberId(memberId);
    setOpenMemberMenu(null);
    try {
      const result = await groupService.demoteMember(group.id, currentUser.id, memberId);
      if (result.success) {
        toast.success('Member demoted');
        onChanged();
      } else {
        toast.error(result.error || 'Failed to demote member');
      }
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    setOpenMemberMenu(null);
    const confirmed = window.confirm(`Remove ${memberName} from this group?`);
    if (!confirmed) return;

    setBusyMemberId(memberId);
    try {
      const result = await groupService.removeMember(group.id, currentUser.id, memberId);
      if (result.success) {
        toast.success(`${memberName} was removed`);
        onChanged();
      } else {
        toast.error(result.error || 'Failed to remove member');
      }
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleLeaveGroup = async () => {
    if (isAdmin && adminCount === 1 && group.members.length > 1) {
      toast.error('Make someone else an admin before you leave');
      return;
    }
    const confirmed = window.confirm(`Leave "${group.name}"? You will stop receiving messages from this group.`);
    if (!confirmed) return;

    setLeaving(true);
    try {
      const result = await groupService.leaveGroup(group.id, currentUser.id);
      if (result.success) {
        toast.success('You left the group');
        onLeftOrDeleted();
      } else {
        toast.error(result.error || 'Failed to leave group');
      }
    } finally {
      setLeaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    const confirmed = window.confirm(`Delete "${group.name}" for everyone? This cannot be undone.`);
    if (!confirmed) return;

    setDeleting(true);
    try {
      const result = await groupService.deleteGroup(group.id, currentUser.id);
      if (result.success) {
        toast.success('Group deleted');
        onLeftOrDeleted();
      } else {
        toast.error(result.error || 'Failed to delete group');
      }
    } finally {
      setDeleting(false);
    }
  };

  const memberIds = new Set(group.members.map((m) => m.user_id));
  const addableFriends = friends.filter(
    (f) =>
      !memberIds.has(f.id) &&
      (f.profile.full_name?.toLowerCase().includes(addSearch.toLowerCase()) ||
        f.profile.username?.toLowerCase().includes(addSearch.toLowerCase()))
  );

  const toggleSelectToAdd = (id: string) => {
    setSelectedToAdd((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAddMembers = async () => {
    if (selectedToAdd.length === 0) return;
    setAddingMembers(true);
    try {
      const results = await Promise.all(selectedToAdd.map((id) => groupService.addMember(group.id, currentUser.id, id)));
      const failed = results.filter((r) => !r.success);
      if (failed.length === 0) {
        toast.success(selectedToAdd.length === 1 ? 'Member added' : `${selectedToAdd.length} members added`);
      } else {
        toast.error('Some members could not be added');
      }
      onChanged();
      setSelectedToAdd([]);
      setAddSearch('');
      setView('info');
    } finally {
      setAddingMembers(false);
    }
  };

  if (view === 'add-members') {
    return (
      <div className="h-full flex flex-col bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50">
        <div className="backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-3 py-3.5 shadow-xl shadow-purple-500/20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setView('info')}
              className="p-2 rounded-xl hover:bg-white/20 transition-all duration-300 active:scale-95"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
            </button>
            <h1 className="text-lg font-bold flex-1">Add Members</h1>
            {selectedToAdd.length > 0 && (
              <button
                onClick={handleAddMembers}
                disabled={addingMembers}
                className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-sm font-semibold transition-all disabled:opacity-50"
              >
                {addingMembers ? 'Adding...' : `Add (${selectedToAdd.length})`}
              </button>
            )}
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/70" strokeWidth={2.5} />
            <input
              type="text"
              placeholder="Search friends..."
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 text-white placeholder-white/60 text-sm focus:outline-none focus:ring-2 focus:ring-white/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {addableFriends.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <Users className="w-16 h-16 text-slate-300 mb-4" />
              <p className="text-sm text-slate-600 font-medium">
                {friends.length === 0 ? 'No friends yet' : 'Everyone is already in this group'}
              </p>
            </div>
          ) : (
            addableFriends.map((friend) => {
              const selected = selectedToAdd.includes(friend.id);
              return (
                <button
                  key={friend.id}
                  onClick={() => toggleSelectToAdd(friend.id)}
                  className={`w-full flex items-center gap-3 p-3 mb-2 rounded-2xl transition-all duration-300 ${
                    selected ? 'bg-violet-100 border-2 border-violet-400' : 'bg-white/70 border border-white/70 hover:bg-white/90'
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
                    {selected && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <h3 className="text-sm font-semibold text-slate-800">{friend.profile.full_name}</h3>
                    {friend.profile.username && <p className="text-xs text-slate-500">@{friend.profile.username}</p>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 overflow-y-auto">
      {/* Header */}
      <div className="backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-3 py-3.5 shadow-xl shadow-purple-500/20 flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-xl hover:bg-white/20 transition-all duration-300 active:scale-95"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
        </button>
        <h1 className="text-lg font-bold flex-1">Group Info</h1>
      </div>

      {/* Avatar + Name/Description */}
      <div className="flex flex-col items-center px-4 py-6">
        <label className={`relative group ${isAdmin ? 'cursor-pointer' : ''}`}>
          <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center shadow-lg shadow-purple-500/30">
            {group.avatar_url ? (
              <img src={group.avatar_url} alt={group.name} className="w-full h-full object-cover" />
            ) : (
              <Users className="w-10 h-10 text-white/80" />
            )}
            {uploadingAvatar && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          {isAdmin && (
            <>
              <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center shadow-lg">
                <Camera className="w-4 h-4 text-white" />
              </div>
              <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            </>
          )}
        </label>

        <div className="mt-4 w-full max-w-sm">
          {editingDetails ? (
            <div className="space-y-3">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={50}
                placeholder="Group name"
                className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 text-center font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
              <textarea
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                maxLength={200}
                rows={2}
                placeholder="Description (optional)"
                className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-700 text-center resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => { setEditingDetails(false); setNameDraft(group.name); setDescriptionDraft(group.description || ''); }}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDetails}
                  disabled={savingDetails}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white text-sm font-medium shadow-md disabled:opacity-50"
                >
                  {savingDetails ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-xl font-bold text-slate-800">{group.name}</h2>
                {isAdmin && (
                  <button
                    onClick={() => setEditingDetails(true)}
                    className="p-1.5 rounded-lg hover:bg-white/60"
                    aria-label="Edit group info"
                  >
                    <Pencil className="w-4 h-4 text-violet-500" />
                  </button>
                )}
              </div>
              {group.description && <p className="text-sm text-slate-500 mt-1">{group.description}</p>}
              <p className="text-xs text-slate-400 mt-1">{group.members.length} members</p>
            </div>
          )}
        </div>
      </div>

      {/* Mute toggle */}
      <div className="mx-4 mb-3 rounded-2xl bg-white/70 backdrop-blur-xl border border-white/70 overflow-hidden">
        <button
          onClick={handleToggleMute}
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/50 transition-all"
        >
          <div className="flex items-center gap-3">
            {isMuted ? <BellOff className="w-5 h-5 text-slate-500" /> : <Bell className="w-5 h-5 text-violet-500" />}
            <span className="text-sm font-medium text-slate-700">{isMuted ? 'Unmute notifications' : 'Mute notifications'}</span>
          </div>
          <div className={`w-10 h-6 rounded-full transition-colors ${isMuted ? 'bg-slate-300' : 'bg-violet-500'} relative`}>
            <div
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                isMuted ? 'translate-x-0.5' : 'translate-x-4'
              }`}
            />
          </div>
        </button>
      </div>

      {/* Members */}
      <div className="mx-4 mb-3 rounded-2xl bg-white/70 backdrop-blur-xl border border-white/70 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">{group.members.length} Members</h3>
          {isAdmin && (
            <button
              onClick={() => setView('add-members')}
              className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700"
            >
              <UserPlus className="w-4 h-4" />
              Add
            </button>
          )}
        </div>

        {group.members.map((member) => {
          const isSelf = member.user_id === currentUser.id;
          const profile = member.profile;
          return (
            <div key={member.user_id} className="relative flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0">
              <button
                onClick={() => !isSelf && onViewProfile?.(member.user_id, profile)}
                disabled={isSelf || !onViewProfile}
                className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-violet-400 to-purple-400 flex-shrink-0 disabled:cursor-default"
                aria-label="View profile"
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white font-bold text-sm">
                    {profile?.full_name?.charAt(0) || '?'}
                  </div>
                )}
              </button>
              <button
                onClick={() => !isSelf && onViewProfile?.(member.user_id, profile)}
                disabled={isSelf || !onViewProfile}
                className="flex-1 min-w-0 text-left disabled:cursor-default"
              >
                <p className="text-sm font-medium text-slate-800 truncate">
                  {isSelf ? 'You' : profile?.full_name || 'Unknown'}
                </p>
                {profile?.username && <p className="text-xs text-slate-400 truncate">@{profile.username}</p>}
              </button>
              {member.role === 'admin' && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-violet-600 flex-shrink-0">
                  <Crown className="w-3 h-3" />
                  Admin
                </span>
              )}

              {isAdmin && !isSelf && (
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setOpenMemberMenu(openMemberMenu === member.user_id ? null : member.user_id)}
                    disabled={busyMemberId === member.user_id}
                    className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50"
                  >
                    <MoreVertical className="w-4 h-4 text-slate-400" />
                  </button>
                  {openMemberMenu === member.user_id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setOpenMemberMenu(null)} />
                      <div className="absolute right-0 top-full mt-1 w-44 rounded-xl bg-white shadow-xl border border-slate-100 overflow-hidden z-50">
                        {member.role === 'admin' ? (
                          <button
                            onClick={() => handleDemote(member.user_id)}
                            className="w-full px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 flex items-center gap-2"
                          >
                            <ShieldMinus className="w-4 h-4 text-slate-500" />
                            Remove as admin
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePromote(member.user_id)}
                            className="w-full px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 flex items-center gap-2"
                          >
                            <ShieldPlus className="w-4 h-4 text-violet-500" />
                            Make admin
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveMember(member.user_id, profile?.full_name || 'this member')}
                          className="w-full px-3.5 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <UserMinus className="w-4 h-4" />
                          Remove from group
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Danger zone */}
      <div className="mx-4 mb-6 rounded-2xl bg-white/70 backdrop-blur-xl border border-white/70 overflow-hidden">
        <button
          onClick={handleLeaveGroup}
          disabled={leaving}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 transition-all disabled:opacity-50 border-b border-slate-50"
        >
          <LogOut className="w-5 h-5" />
          {leaving ? 'Leaving...' : 'Leave Group'}
        </button>
        {isAdmin && (
          <button
            onClick={handleDeleteGroup}
            disabled={deleting}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
          >
            <Trash2 className="w-5 h-5" />
            {deleting ? 'Deleting...' : 'Delete Group'}
          </button>
        )}
      </div>
    </div>
  );
}

export default GroupInfo;
