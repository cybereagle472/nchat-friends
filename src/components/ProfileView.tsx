import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  MessageCircle,
  Phone,
  Video,
  UserPlus,
  UserMinus,
  UserCheck,
  UserX,
  ShieldOff,
  MoreVertical,
  Clock3,
  Check,
  X as XIcon
} from 'lucide-react';
import { UserProfile, Contact } from '../types';
import { profileService } from '../services/profileService';
import { friendService } from '../services/friendService';
import { presenceStatusText } from '../utils/presenceFormat';

interface ProfileViewProps {
  currentUser: UserProfile;
  userId: string;
  /** Shown immediately (avoids a blank/loading flash) while the fresh,
   *  privacy-filtered profile loads in the background. */
  initialProfile?: UserProfile;
  onClose: () => void;
  onMessage: (contact: Contact) => void;
  onCall: (userId: string, type: 'voice' | 'video') => void;
  /** Called after any action that changes the friendship/block relationship,
   *  so the screen that opened this profile can refresh its own lists. */
  onChanged?: () => void;
}

type Relation = 'loading' | 'self' | 'friend' | 'pending_sent' | 'pending_received' | 'none';
type ConfirmKind = 'remove' | 'block' | null;

export function ProfileView({ currentUser, userId, initialProfile, onClose, onMessage, onCall, onChanged }: ProfileViewProps) {
  const isSelf = userId === currentUser.id;

  const [profile, setProfile] = useState<UserProfile | null>(initialProfile ?? null);
  const [loading, setLoading] = useState(!initialProfile);
  const [notFound, setNotFound] = useState(false);
  const [relation, setRelation] = useState<Relation>(isSelf ? 'self' : 'loading');
  const [isBlocked, setIsBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [freshProfile, friendsResult, blockedResult, requestsResult] = await Promise.all([
        profileService.getProfile(userId),
        friendService.getFriends(currentUser.id),
        friendService.getBlockedUsers(currentUser.id),
        friendService.getRequests(currentUser.id)
      ]);
      if (cancelled) return;

      if (freshProfile) {
        setProfile(freshProfile);
      } else if (!initialProfile) {
        setNotFound(true);
      }
      setLoading(false);

      if (isSelf) {
        setRelation('self');
      } else {
        const friendIds = friendsResult.data?.friendIds ?? [];
        if (friendIds.includes(userId)) {
          setRelation('friend');
        } else {
          const sentPending = requestsResult.data?.sent.some((r) => r.receiver_id === userId);
          const receivedPending = requestsResult.data?.received.some((r) => r.sender_id === userId);
          setRelation(sentPending ? 'pending_sent' : receivedPending ? 'pending_received' : 'none');
        }
      }

      const blocked = blockedResult.data ?? [];
      setIsBlocked(blocked.some((u) => u.id === userId));
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, currentUser.id, isSelf, initialProfile]);

  const handleMessage = useCallback(() => {
    if (!profile) return;
    onMessage({ user_id: userId, status: 'accepted', profile });
    onClose();
  }, [profile, userId, onMessage, onClose]);

  const handleCall = useCallback(
    (type: 'voice' | 'video') => {
      onCall(userId, type);
      onClose();
    },
    [userId, onCall, onClose]
  );

  const handleAddFriend = useCallback(async () => {
    setBusy(true);
    try {
      const result = await friendService.sendRequest(currentUser.id, userId);
      if (result.success) {
        setRelation('pending_sent');
        onChanged?.();
      } else {
        toast.error(result.error || 'Failed to send friend request');
      }
    } finally {
      setBusy(false);
    }
  }, [currentUser.id, userId, onChanged]);

  const handleCancelRequest = useCallback(async () => {
    setBusy(true);
    try {
      const result = await friendService.cancelRequest(currentUser.id, userId);
      if (result.success) {
        setRelation('none');
        onChanged?.();
      } else {
        toast.error(result.error || 'Failed to cancel request');
      }
    } finally {
      setBusy(false);
    }
  }, [currentUser.id, userId, onChanged]);

  const handleAcceptRequest = useCallback(async () => {
    setBusy(true);
    try {
      const result = await friendService.acceptRequest(userId, currentUser.id);
      if (result.success) {
        setRelation('friend');
        onChanged?.();
      } else {
        toast.error(result.error || 'Failed to accept request');
      }
    } finally {
      setBusy(false);
    }
  }, [currentUser.id, userId, onChanged]);

  const handleDeclineRequest = useCallback(async () => {
    setBusy(true);
    try {
      const result = await friendService.declineRequest(userId, currentUser.id);
      if (result.success) {
        setRelation('none');
        onChanged?.();
      } else {
        toast.error(result.error || 'Failed to decline request');
      }
    } finally {
      setBusy(false);
    }
  }, [currentUser.id, userId, onChanged]);

  const handleRemoveFriend = useCallback(async () => {
    setBusy(true);
    try {
      const result = await friendService.removeFriend(currentUser.id, userId);
      if (result.success) {
        setRelation('none');
        setConfirmKind(null);
        onChanged?.();
      } else {
        toast.error(result.error || 'Failed to remove friend');
      }
    } finally {
      setBusy(false);
    }
  }, [currentUser.id, userId, onChanged]);

  const handleBlock = useCallback(async () => {
    setBusy(true);
    try {
      const result = await friendService.blockUser(currentUser.id, userId);
      if (result.success) {
        setIsBlocked(true);
        setRelation('none');
        setConfirmKind(null);
        onChanged?.();
      } else {
        toast.error(result.error || 'Failed to block user');
      }
    } finally {
      setBusy(false);
    }
  }, [currentUser.id, userId, onChanged]);

  const handleUnblock = useCallback(async () => {
    setBusy(true);
    try {
      const result = await friendService.unblockUser(currentUser.id, userId);
      if (result.success) {
        setIsBlocked(false);
        onChanged?.();
      } else {
        toast.error(result.error || 'Failed to unblock user');
      }
    } finally {
      setBusy(false);
    }
  }, [currentUser.id, userId, onChanged]);

  const displayName = profile?.full_name || initialProfile?.full_name || 'Profile';
  const avatarUrl = profile?.avatar_url;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center animate-fade-in">
      <div className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl bg-white shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 px-4 pt-4 pb-16 flex items-center justify-between flex-shrink-0">
          <button
            onClick={onClose}
            className="p-2 -ml-1 rounded-full hover:bg-white/20 active:bg-white/30 transition-all text-white"
            aria-label="Close"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <span className="text-white font-semibold text-sm">Profile</span>
          {!isSelf && relation !== 'loading' ? (
            <div className="relative">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="p-2 -mr-1 rounded-full hover:bg-white/20 active:bg-white/30 transition-all text-white"
                aria-label="More options"
              >
                <MoreVertical className="w-5 h-5" strokeWidth={2} />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-48 rounded-xl bg-white shadow-xl border border-slate-100 overflow-hidden z-20 text-left">
                    {relation === 'friend' && (
                      <button
                        onClick={() => {
                          setShowMenu(false);
                          setConfirmKind('remove');
                        }}
                        className="w-full px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 flex items-center gap-2"
                      >
                        <UserMinus className="w-4 h-4 text-slate-500" />
                        Remove friend
                      </button>
                    )}
                    {isBlocked ? (
                      <button
                        onClick={() => {
                          setShowMenu(false);
                          handleUnblock();
                        }}
                        disabled={busy}
                        className="w-full px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 flex items-center gap-2 disabled:opacity-50"
                      >
                        <ShieldOff className="w-4 h-4 text-green-600" />
                        Unblock
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setShowMenu(false);
                          setConfirmKind('block');
                        }}
                        className="w-full px-3.5 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <UserX className="w-4 h-4" />
                        Block user
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="w-9" />
          )}
        </div>

        {/* Avatar — overlapping the header, WhatsApp/Instagram style */}
        <div className="flex justify-center -mt-14 flex-shrink-0">
          <div className="w-28 h-28 rounded-full ring-4 ring-white bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center text-4xl overflow-hidden shadow-lg">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-white font-bold">{displayName.charAt(0).toUpperCase()}</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
          {notFound ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-500">This profile is no longer available.</p>
            </div>
          ) : (
            <>
              {/* Name / username / presence */}
              <div className="text-center mb-5">
                <h2 className="text-lg font-bold text-slate-800">{displayName}</h2>
                {profile?.username && <p className="text-sm text-violet-600 font-medium">@{profile.username}</p>}
                {!isSelf && (
                  <p className="text-xs text-slate-500 mt-1 flex items-center justify-center gap-1">
                    {profile?.is_online ? (
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                    ) : (
                      <Clock3 className="w-3 h-3" />
                    )}
                    {presenceStatusText(profile?.is_online, profile?.last_seen)}
                  </p>
                )}
              </div>

              {/* Bio / about */}
              {profile?.bio && (
                <div className="bg-slate-50 rounded-2xl p-4 mb-5">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">About</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{profile.bio}</p>
                </div>
              )}

              {loading && !profile && (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                </div>
              )}

              {!isSelf && !loading && (
                <>
                  {isBlocked ? (
                    <div className="bg-red-50 border border-red-100 rounded-2xl p-4 text-center">
                      <p className="text-sm text-red-600 font-medium mb-3">You blocked {displayName}</p>
                      <button
                        onClick={handleUnblock}
                        disabled={busy}
                        className="w-full py-2.5 rounded-xl bg-white border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        {busy ? 'Unblocking...' : 'Unblock'}
                      </button>
                    </div>
                  ) : relation === 'friend' ? (
                    <div className="flex items-center justify-center gap-3">
                      <button
                        onClick={handleMessage}
                        className="flex flex-col items-center gap-1.5 text-violet-600"
                        aria-label="Message"
                      >
                        <span className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center hover:bg-violet-200 active:scale-95 transition-all">
                          <MessageCircle className="w-5 h-5" strokeWidth={2.5} />
                        </span>
                        <span className="text-[11px] font-medium">Message</span>
                      </button>
                      <button
                        onClick={() => handleCall('voice')}
                        className="flex flex-col items-center gap-1.5 text-violet-600"
                        aria-label="Voice call"
                      >
                        <span className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center hover:bg-violet-200 active:scale-95 transition-all">
                          <Phone className="w-5 h-5" strokeWidth={2.5} />
                        </span>
                        <span className="text-[11px] font-medium">Voice</span>
                      </button>
                      <button
                        onClick={() => handleCall('video')}
                        className="flex flex-col items-center gap-1.5 text-violet-600"
                        aria-label="Video call"
                      >
                        <span className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center hover:bg-violet-200 active:scale-95 transition-all">
                          <Video className="w-5 h-5" strokeWidth={2.5} />
                        </span>
                        <span className="text-[11px] font-medium">Video</span>
                      </button>
                    </div>
                  ) : relation === 'pending_received' ? (
                    <div className="flex gap-3">
                      <button
                        onClick={handleDeclineRequest}
                        disabled={busy}
                        className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <XIcon className="w-4 h-4" />
                        Decline
                      </button>
                      <button
                        onClick={handleAcceptRequest}
                        disabled={busy}
                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <Check className="w-4 h-4" />
                        Accept request
                      </button>
                    </div>
                  ) : relation === 'pending_sent' ? (
                    <button
                      onClick={handleCancelRequest}
                      disabled={busy}
                      className="w-full py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 font-semibold text-sm hover:bg-amber-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <UserCheck className="w-4 h-4" />
                      {busy ? 'Cancelling...' : 'Request sent · Cancel'}
                    </button>
                  ) : (
                    <button
                      onClick={handleAddFriend}
                      disabled={busy}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <UserPlus className="w-4 h-4" />
                      {busy ? 'Sending...' : 'Add friend'}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Remove-friend / Block confirmation */}
      {confirmKind && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                {confirmKind === 'remove' ? (
                  <UserMinus className="w-8 h-8 text-red-500" />
                ) : (
                  <UserX className="w-8 h-8 text-red-500" />
                )}
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">
                {confirmKind === 'remove' ? `Remove ${displayName}?` : `Block ${displayName}?`}
              </h3>
              <p className="text-sm text-slate-500 mb-6">
                {confirmKind === 'remove'
                  ? `You can always add ${displayName} back later.`
                  : 'Blocked users cannot send you messages or call you. They will also be removed from your friends list.'}
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setConfirmKind(null)}
                  disabled={busy}
                  className="flex-1 py-3 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmKind === 'remove' ? handleRemoveFriend : handleBlock}
                  disabled={busy}
                  className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-semibold text-sm hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {busy ? 'Please wait...' : confirmKind === 'remove' ? 'Remove' : 'Block'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.2s ease-out; }
        .animate-slide-up { animation: slide-up 0.25s ease-out; }
      `}</style>
    </div>
  );
}
