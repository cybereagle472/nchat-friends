import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { Toaster, toast } from 'sonner';
import { MessageCircle, Circle, UsersRound, Compass, Clock } from 'lucide-react';
import { Auth } from './components/Auth';
import { Chats } from './components/Chats';

// Everything below is loaded on demand instead of bundled into the initial
// download. `Chats` (the default landing tab) and `Auth` (the logged-out
// landing screen) stay eager above since one of them is needed on every
// single app load anyway — splitting them out would only add a pointless
// extra network round trip. Every other screen here (including ChatView,
// the single largest component in the app) is only needed once the user
// actually navigates to it, so there's no reason to make every visitor pay
// for its weight up front.
const ProfileSetup = lazy(() => import('./components/ProfileSetup').then((m) => ({ default: m.ProfileSetup })));
const ChatView = lazy(() => import('./components/ChatView').then((m) => ({ default: m.ChatView })));
const Status = lazy(() => import('./components/Status').then((m) => ({ default: m.Status })));
const Groups = lazy(() => import('./components/Groups').then((m) => ({ default: m.Groups })));
const GroupChatView = lazy(() => import('./components/GroupChatView').then((m) => ({ default: m.GroupChatView })));
const GroupInfo = lazy(() => import('./components/GroupInfo').then((m) => ({ default: m.GroupInfo })));
const CreateGroup = lazy(() => import('./components/CreateGroup').then((m) => ({ default: m.CreateGroup })));
const Discover = lazy(() => import('./components/Discover').then((m) => ({ default: m.Discover })));
const History = lazy(() => import('./components/History').then((m) => ({ default: m.History })));
const Settings = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })));
const CallModal = lazy(() => import('./components/CallModal').then((m) => ({ default: m.CallModal })));
const ProfileView = lazy(() => import('./components/ProfileView').then((m) => ({ default: m.ProfileView })));
import { authService, ProfileResolution } from './services/authService';
import { profileService } from './services/profileService';
import {
  markProfileComplete,
  getCurrentUserId as getStoredUserIdSync,
  getStoredAuth,
  wasProfileEverComplete,
  getCachedUserProfile,
} from './lib/apiClient';
import { callService } from './services/callService';
import { GroupWithMembers } from './services/groupService';
import { UserProfile, Contact, Call } from './types';
import { realtimeClient } from './lib/realtimeClient';
import { useAppData } from './hooks/useAppData';

type AppView = 'chats' | 'status' | 'groups' | 'discover' | 'history';

// Shared fallback shown for the brief moment a lazy-loaded screen's code is
// still downloading (effectively only on its very first visit — the
// browser caches the chunk after that). Matches the existing cold-start
// loading screen so a lazy chunk load never looks like a different app.
function AppLoadingScreen() {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-xl shadow-purple-500/40 animate-pulse">
        <MessageCircle className="w-10 h-10 text-white" />
      </div>
      <h1 className="mt-4 text-xl font-bold bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
        NChat
      </h1>
    </div>
  );
}

interface CallState {
  active: boolean;
  calleeId?: string;
  callType: 'audio' | 'video';
  incomingCall?: Call;
}

function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  // Session is valid but we couldn't confirm the profile after retrying
  // (server/network hiccup) — show a "try again" screen instead of guessing
  // (never assume a dropped request means "new user, needs onboarding").
  const [sessionError, setSessionError] = useState(false);

  // App state
  const [activeTab, setActiveTab] = useState<AppView>('chats');
  const [selectedChat, setSelectedChat] = useState<Contact | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupWithMembers | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [callState, setCallState] = useState<CallState>({
    active: false,
    callType: 'audio'
  });

  // Applies the result of authService.resolveProfileState to app state.
  // Shared by the background reconciliation below and by the SIGNED_IN
  // handler, so both treat every outcome the same safe way — in
  // particular, a mere "couldn't confirm it this time" (sessionError) must
  // never interrupt someone who's already looking at the app with a
  // perfectly good cached profile; only a *confirmed* dead session
  // (sessionInvalid) is ever allowed to do that.
  const applyProfileResolution = useCallback((userId: string, resolution: ProfileResolution) => {
    if (resolution.sessionInvalid) {
      realtimeClient.disconnect();
      setIsAuthenticated(false);
      setCurrentUser(null);
      setNeedsProfileSetup(false);
      setUserId(null);
      setUserEmail('');
      setSessionError(false);
      return;
    }
    if (resolution.user) {
      setCurrentUser(resolution.user);
      setNeedsProfileSetup(false);
      setSessionError(false);
      if (resolution.user.email) setUserEmail(resolution.user.email);
      return;
    }
    if (resolution.sessionError) {
      // Couldn't confirm the profile this time. If we (or the cache-first
      // bootstrap below) already have a known-good cached profile for this
      // exact account, just keep it — there's nothing to show the user
      // over a background check that didn't pan out. Only show the "try
      // again" screen when there's truly nothing to fall back to.
      const cached = getCachedUserProfile(userId);
      if (cached) {
        setCurrentUser(cached);
        setNeedsProfileSetup(false);
        setSessionError(false);
      } else {
        setSessionError(true);
      }
      return;
    }
    // Retried and it genuinely never looked complete — a real, brand-new
    // account that hasn't finished onboarding yet.
    setNeedsProfileSetup(true);
  }, []);

  // Check auth on mount (and whenever the user retries from the session-error screen)
  const checkAuth = useCallback(async () => {
    const userId = getStoredUserIdSync();
    const auth = getStoredAuth();

    // Cache-first bootstrap: if we've ever confirmed this exact account's
    // profile as complete on this device before, open straight into the
    // app right now using whatever's cached — the same way WhatsApp/
    // Telegram/Messenger open to your chats immediately and reconcile with
    // the server quietly afterward, rather than gating every single
    // launch on a network round trip that can (and, per the reports this
    // was built to fix, does) occasionally fail for reasons that have
    // nothing to do with whether the account is actually fine. A single
    // failed check here can therefore never again bounce an established
    // user back to onboarding or a blocking error screen; only a
    // *confirmed* dead session (handled inside applyProfileResolution)
    // can sign them out from this point on.
    if (userId && auth && wasProfileEverComplete(userId)) {
      const bestEffortProfile: UserProfile =
        getCachedUserProfile(userId) ?? {
          id: auth.user.id,
          email: auth.user.email,
          full_name: auth.user.full_name || '',
        };
      setIsAuthenticated(true);
      setCurrentUser(bestEffortProfile);
      setNeedsProfileSetup(false);
      setSessionError(false);
      setUserId(userId);
      if (bestEffortProfile.email) setUserEmail(bestEffortProfile.email);
      setLoading(false);

      void authService.resolveProfileState(userId).then((resolution) => {
        applyProfileResolution(userId, resolution);
      });
      return;
    }

    // No local evidence this account has ever finished onboarding on this
    // device (brand-new signup, first-ever visit here, or genuinely signed
    // out) — this is the only situation where it's actually correct to
    // gate the UI on the network: there's nothing honest to show yet.
    setLoading(true);
    try {
      const authState = await authService.checkSession();
      setSessionError(!!authState.sessionError);
      setIsAuthenticated(authState.isAuthenticated);
      setNeedsProfileSetup(authState.needsProfileSetup);
      setCurrentUser(authState.user);

      if (authState.isAuthenticated) {
        setUserId(userId);

        if (authState.user?.email) {
          setUserEmail(authState.user.email);
        }
      }
    } catch (error) {
      console.error('Auth check error:', error);
    } finally {
      setLoading(false);
    }
  }, [applyProfileResolution]);

  useEffect(() => {
    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = authService.onAuthChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setSessionError(false);
        setIsAuthenticated(true);
        setUserId(session.user.id);
        setUserEmail(session.user.email || '');

        // Resolve the profile the same safe way checkSession does: a
        // dropped request here must never be confused with "brand new
        // user" and silently drop them into onboarding again.
        const resolution = await authService.resolveProfileState(session.user.id);
        applyProfileResolution(session.user.id, resolution);
      } else if (event === 'SIGNED_OUT') {
        // Also covers another tab signing out (see the cross-tab 'storage'
        // sync in lib/apiClient.ts) — make sure the realtime socket this
        // tab opened doesn't linger on a now-dead session.
        realtimeClient.disconnect();
        setIsAuthenticated(false);
        setCurrentUser(null);
        setNeedsProfileSetup(false);
        setUserId(null);
        setUserEmail('');
        setSessionError(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [checkAuth, applyProfileResolution]);

  // Update online status.
  // The Worker derives is_online server-side from a presence heartbeat
  // timestamp (see worker/src/routes/users.ts POST /presence) — there's no
  // explicit "set offline" call; a user is simply considered offline once
  // their last heartbeat is older than the server's threshold.
  useEffect(() => {
    if (!currentUser?.id) return;

    const sendHeartbeat = () => {
      void profileService.updateLastSeen(currentUser.id);
    };

    sendHeartbeat();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Periodic heartbeat
    const heartbeat = setInterval(sendHeartbeat, 30000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(heartbeat);
    };
  }, [currentUser?.id]);

  // Subscribe to incoming calls
  useEffect(() => {
    if (!currentUser?.id) return;

    const unsubscribe = callService.subscribeToIncomingCalls((callSession) => {
      if (callSession.status !== 'initiated' && callSession.status !== 'ringing') return;

      // No call-waiting support: if we're already on a call, automatically
      // decline the new one instead of silently dropping it (which would
      // otherwise leave the second caller ringing forever with no feedback).
      setCallState((prev) => {
        if (prev.active) {
          callService.endCall(callSession.id, 'declined');
          return prev;
        }
        const incomingCall: Call = {
          id: callSession.id,
          caller_id: callSession.callerId,
          receiver_id: callSession.receiverId,
          call_type: callSession.callType,
          status: callSession.status,
          created_at: callSession.startedAt,
          offer_sdp: callSession.offerSdp,
          caller_profile: callSession.callerProfile
        };
        return {
          active: true,
          callType: callSession.callType,
          incomingCall
        };
      });
    });

    return () => {
      unsubscribe();
    };
  }, [currentUser?.id]);

  const handleAuthSuccess = useCallback(async () => {
    const id = await authService.getCurrentUserId();
    if (!id) return;
    setUserId(id);
    // The login/signup call that led here already proves the session is
    // valid — resolveProfileState below only needs to figure out the
    // profile side of things (and applyProfileResolution still handles the
    // rare case where something's gone more seriously wrong).
    setIsAuthenticated(true);
    const resolution = await authService.resolveProfileState(id);
    applyProfileResolution(id, resolution);
  }, [applyProfileResolution]);

  const handleProfileComplete = useCallback((profile: UserProfile) => {
    // Record it right away (not just on the next bootstrap's
    // resolveProfileState call) so the "never send an already-set-up user
    // back through onboarding" safety net in authService is active from
    // this moment on, even if the app gets backgrounded immediately after.
    if (profile.id) markProfileComplete(profile.id);
    setCurrentUser(profile);
    setNeedsProfileSetup(false);
  }, []);

  const handleOpenChat = useCallback((contact: Contact) => {
    setSelectedChat(contact);
  }, []);

  const handleBackToChats = useCallback(() => {
    setSelectedChat(null);
  }, []);

  const handleCall = useCallback((userId: string, type: 'voice' | 'video') => {
    setCallState({
      active: true,
      calleeId: userId,
      callType: type === 'voice' ? 'audio' : 'video'
    });
  }, []);

  const handleCloseCall = useCallback(() => {
    setCallState({
      active: false,
      callType: 'audio'
    });
  }, []);

  const handleMessageFromHistory = useCallback(async (userId: string) => {
    // Get profile for the user
    const profile = await profileService.getProfile(userId);
    if (profile) {
      setSelectedChat({
        user_id: userId,
        status: 'accepted',
        profile
      });
      setActiveTab('chats');
    }
  }, []);

  // Group handlers
  const handleOpenGroup = useCallback((group: GroupWithMembers) => {
    setSelectedGroup(group);
  }, []);

  const handleBackFromGroup = useCallback(() => {
    setSelectedGroup(null);
    setShowCreateGroup(false);
  }, []);

  const handleGroupCreated = useCallback((_groupId: string) => {
    setShowCreateGroup(false);
    // Optionally navigate to the new group
    setActiveTab('groups');
  }, []);

  // Settings handlers
  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const handleLogout = useCallback(() => {
    realtimeClient.disconnect();
    setIsAuthenticated(false);
    setCurrentUser(null);
    setShowSettings(false);
  }, []);

  const handleProfileUpdate = useCallback((profile: UserProfile) => {
    setCurrentUser(profile);
  }, []);

  // Loading state - Static splash, no spinner
  if (loading) {
    return <AppLoadingScreen />;
  }

  // Auth screen
  if (!isAuthenticated) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  // Your session is fine, but we couldn't confirm your profile after
  // retrying (server/network hiccup) — never guess "needs onboarding" here,
  // just let the user retry.
  if (sessionError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-xl shadow-purple-500/40">
          <MessageCircle className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-lg font-bold text-slate-800">Couldn't reach NChat</h1>
        <p className="text-sm text-slate-500 max-w-xs">
          You're still signed in — we just couldn't load your profile. Check your connection and try again.
        </p>
        <button
          onClick={() => checkAuth()}
          className="mt-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white text-sm font-semibold shadow-lg shadow-violet-500/30 hover:scale-105 active:scale-95 transition-transform"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Profile setup screen
  if (needsProfileSetup && userId) {
    return (
      <Suspense fallback={<AppLoadingScreen />}>
        <ProfileSetup
          userId={userId}
          email={userEmail}
          onComplete={handleProfileComplete}
        />
      </Suspense>
    );
  }

  // Main app
  if (!currentUser) return null;

  return (
    <MainApp
      currentUser={currentUser}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      selectedChat={selectedChat}
      selectedGroup={selectedGroup}
      showCreateGroup={showCreateGroup}
      setShowCreateGroup={setShowCreateGroup}
      showSettings={showSettings}
      callState={callState}
      handleOpenChat={handleOpenChat}
      handleBackToChats={handleBackToChats}
      handleCall={handleCall}
      handleCloseCall={handleCloseCall}
      handleOpenGroup={handleOpenGroup}
      handleBackFromGroup={handleBackFromGroup}
      handleGroupCreated={handleGroupCreated}
      handleOpenSettings={handleOpenSettings}
      handleCloseSettings={handleCloseSettings}
      handleLogout={handleLogout}
      handleProfileUpdate={handleProfileUpdate}
      handleMessageFromHistory={handleMessageFromHistory}
    />
  );
}

// Main App with preloaded data
function MainApp({
  currentUser,
  activeTab,
  setActiveTab,
  selectedChat,
  selectedGroup,
  showCreateGroup,
  setShowCreateGroup,
  showSettings,
  callState,
  handleOpenChat,
  handleBackToChats,
  handleCall,
  handleCloseCall,
  handleOpenGroup,
  handleBackFromGroup,
  handleGroupCreated,
  handleOpenSettings,
  handleCloseSettings,
  handleLogout,
  handleProfileUpdate,
  handleMessageFromHistory
}: {
  currentUser: UserProfile;
  activeTab: AppView;
  setActiveTab: (tab: AppView) => void;
  selectedChat: Contact | null;
  selectedGroup: GroupWithMembers | null;
  showCreateGroup: boolean;
  setShowCreateGroup: (show: boolean) => void;
  showSettings: boolean;
  callState: CallState;
  handleOpenChat: (contact: Contact) => void;
  handleBackToChats: () => void;
  handleCall: (userId: string, type: 'voice' | 'video') => void;
  handleCloseCall: () => void;
  handleOpenGroup: (group: GroupWithMembers) => void;
  handleBackFromGroup: () => void;
  handleGroupCreated: (groupId: string) => void;
  handleOpenSettings: () => void;
  handleCloseSettings: () => void;
  handleLogout: () => void;
  handleProfileUpdate: (profile: UserProfile) => void;
  handleMessageFromHistory: (userId: string) => void;
}) {
  // Preload ALL data on mount - this is the key to instant tabs. Passing the
  // currently-open chat's id lets the hook avoid bumping that chat's unread
  // badge for messages the user is already looking at live.
  const appData = useAppData(currentUser.id, selectedChat?.user_id ?? null);

  // The moment a chat is opened (from the Chats list, Discover, or call
  // history), its unread badge should disappear instantly rather than
  // waiting for the next full chats refresh — which could otherwise race
  // with the server-side mark-as-read call and leave a stale badge showing.
  useEffect(() => {
    if (selectedChat?.user_id) {
      appData.markChatRead(selectedChat.user_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?.user_id]);

  // `selectedChat` is a snapshot taken at the moment a chat was opened (from
  // the Chats list, Discover, or history), so its `profile` (online status,
  // avatar, etc.) would otherwise stay frozen for as long as the chat stays
  // open. Re-derive it from the live chats/friends lists (refreshed by
  // realtime events + the presence poll in useAppData) so things like the
  // "Online"/"Offline" header and typing indicator reflect reality while
  // you're actively looking at the conversation.
  const liveSelectedChat = useMemo(() => {
    if (!selectedChat) return null;
    const liveChat = appData.chats.find(c => c.user_id === selectedChat.user_id);
    if (liveChat) return liveChat;
    const liveFriend = appData.friends.find(f => f.id === selectedChat.user_id);
    if (liveFriend) return { ...selectedChat, profile: liveFriend.profile };
    return selectedChat;
  }, [selectedChat, appData.chats, appData.friends]);

  // Same idea as liveSelectedChat, but for the currently-open group: a
  // rename, avatar change, member joining/leaving/being promoted, or the
  // group being deleted out from under you should all show up immediately
  // in the open chat's header/member list instead of only after reopening
  // it, since appData.groups is already kept fresh by realtime events +
  // refreshGroups() (see useAppData.ts).
  const liveSelectedGroup = useMemo(() => {
    if (!selectedGroup) return null;
    return appData.groups.find(g => g.id === selectedGroup.id) || selectedGroup;
  }, [selectedGroup, appData.groups]);

  const [showGroupInfo, setShowGroupInfo] = useState(false);

  // Profile preview — a lightweight overlay that can be opened from anywhere
  // (a chat header, a friends/discover row, a group member, call history)
  // to view someone's profile, independent of whichever tab/screen is
  // currently showing.
  const [viewProfile, setViewProfile] = useState<{ userId: string; initialProfile?: UserProfile } | null>(null);

  const handleViewProfile = useCallback((userId: string, initialProfile?: UserProfile) => {
    // Viewing your own profile here doesn't make sense — Settings already
    // owns that, with editing. Route it there instead of showing a
    // read-only duplicate.
    if (userId === currentUser.id) {
      handleOpenSettings();
      return;
    }
    setViewProfile({ userId, initialProfile });
  }, [currentUser.id, handleOpenSettings]);

  const handleCloseProfileView = useCallback(() => {
    setViewProfile(null);
  }, []);

  const handleProfileRelationChanged = useCallback(() => {
    appData.refreshFriends();
    appData.refreshRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If someone else removes you from a group (or deletes it) while you
  // still have it open, appData.groups (kept live by realtime events) will
  // stop containing it. Rather than silently leaving you on a now-stale
  // view where sending a message would fail with a confusing 403, back out
  // of it automatically with a plain-language explanation — exactly the
  // kind of "frustrating error" this should never surface as.
  useEffect(() => {
    if (!appData.isReady || !selectedGroup) return;
    const stillIn = appData.groups.some(g => g.id === selectedGroup.id);
    if (!stillIn) {
      toast.info('You are no longer in this group');
      setShowGroupInfo(false);
      handleBackFromGroup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appData.isReady, appData.groups, selectedGroup]);

  const handleManageGroup = useCallback(() => {
    setShowGroupInfo(true);
  }, []);

  const handleGroupInfoChanged = useCallback(() => {
    // Optimistic refresh for the person who just made the change — the
    // Worker also broadcasts the same event back to them over realtime
    // (see useAppData.ts), so this just avoids waiting on that round trip.
    appData.refreshGroups();
  }, [appData]);

  const handleGroupLeftOrDeleted = useCallback(() => {
    setShowGroupInfo(false);
    handleBackFromGroup();
    appData.refreshGroups();
  }, [appData, handleBackFromGroup]);

  // Wrap the outer App's onGroupCreated so the brand-new group shows up in
  // the Groups tab immediately instead of waiting for the next realtime
  // event or the 45s safety-net poll.
  const handleGroupCreatedWithRefresh = useCallback(async (groupId: string) => {
    await appData.refreshGroups();
    handleGroupCreated(groupId);
  }, [appData, handleGroupCreated]);

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 relative overflow-hidden">
      {/* Animated Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-4 w-64 h-64 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-60 animate-blob"></div>
        <div className="absolute top-0 -right-4 w-64 h-64 bg-fuchsia-300 rounded-full mix-blend-multiply filter blur-xl opacity-60 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-64 h-64 bg-violet-300 rounded-full mix-blend-multiply filter blur-xl opacity-60 animate-blob animation-delay-4000"></div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative z-10">
        <Suspense fallback={<AppLoadingScreen />}>
        {showSettings ? (
          <Settings
            currentUser={currentUser}
            onBack={handleCloseSettings}
            onLogout={handleLogout}
            onProfileUpdate={handleProfileUpdate}
          />
        ) : liveSelectedChat ? (
          <ChatView
            currentUser={currentUser}
            contact={liveSelectedChat}
            onBack={handleBackToChats}
            onCall={(type) => handleCall(liveSelectedChat.user_id, type)}
            onViewProfile={() => handleViewProfile(liveSelectedChat.user_id, liveSelectedChat.profile)}
          />
        ) : liveSelectedGroup && showGroupInfo ? (
          <GroupInfo
            currentUser={currentUser}
            group={liveSelectedGroup}
            friends={appData.friends}
            onBack={() => setShowGroupInfo(false)}
            onChanged={handleGroupInfoChanged}
            onLeftOrDeleted={handleGroupLeftOrDeleted}
            onViewProfile={handleViewProfile}
          />
        ) : liveSelectedGroup ? (
          <GroupChatView
            currentUser={currentUser}
            group={liveSelectedGroup}
            onBack={handleBackFromGroup}
            onManageGroup={handleManageGroup}
          />
        ) : showCreateGroup ? (
          <CreateGroup
            currentUser={currentUser}
            onBack={handleBackFromGroup}
            onGroupCreated={handleGroupCreatedWithRefresh}
          />
        ) : (
          <>
            {activeTab === 'chats' && (
              <Chats
                currentUser={currentUser}
                chats={appData.chats}
                onOpenChat={handleOpenChat}
                onCreateNewChat={() => setActiveTab('discover')}
                onOpenSettings={handleOpenSettings}
              />
            )}
            {activeTab === 'status' && (
              <Status
                currentUser={currentUser}
                friends={appData.friends}
              />
            )}
            {activeTab === 'groups' && (
              <Groups
                currentUser={currentUser}
                groups={appData.groups}
                onOpenGroup={handleOpenGroup}
                onCreateGroup={() => setShowCreateGroup(true)}
              />
            )}
            {activeTab === 'discover' && (
              <Discover
                currentUser={currentUser}
                friends={appData.friends}
                requests={appData.friendRequests}
                suggestions={appData.suggestions}
                sentRequestIds={appData.sentRequestIds}
                onAddFriend={appData.addSentRequest}
                onRefresh={appData.refreshRequests}
                onMessage={handleOpenChat}
                onCall={handleCall}
                onViewProfile={handleViewProfile}
              />
            )}
            {activeTab === 'history' && (
              <History
                currentUser={currentUser}
                history={appData.callHistory}
                onCall={handleCall}
                onMessage={handleMessageFromHistory}
                onViewProfile={handleViewProfile}
              />
            )}
          </>
        )}
        </Suspense>
      </div>

      {/* Bottom Navigation */}
      {!selectedChat && !selectedGroup && !showCreateGroup && !showSettings && (
        <nav className="relative z-20 mx-3 mb-3 backdrop-blur-2xl bg-white/50 border border-white/60 rounded-3xl px-1.5 py-2 shadow-2xl shadow-purple-500/10">
          <div className="flex justify-around items-center max-w-2xl mx-auto gap-0.5">
            <button
              onClick={() => setActiveTab('chats')}
              className={`flex flex-col items-center gap-0.5 px-2 sm:px-3 py-2 rounded-xl transition-all duration-300 transform ${
                activeTab === 'chats'
                  ? 'bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/40 scale-105'
                  : 'text-slate-500 hover:text-violet-600 hover:bg-white/60 hover:scale-105 active:scale-95'
              }`}
              aria-label="Chats"
              aria-current={activeTab === 'chats' ? 'page' : undefined}
            >
              <MessageCircle
                className={`w-4 h-4 transition-all duration-300 ${
                  activeTab === 'chats' ? 'fill-white' : ''
                }`}
                strokeWidth={2.5}
              />
              <span className="text-[9px] font-medium mt-0.5">Chats</span>
            </button>

            <button
              onClick={() => setActiveTab('status')}
              className={`flex flex-col items-center gap-0.5 px-2 sm:px-3 py-2 rounded-xl transition-all duration-300 transform ${
                activeTab === 'status'
                  ? 'bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/40 scale-105'
                  : 'text-slate-500 hover:text-violet-600 hover:bg-white/60 hover:scale-105 active:scale-95'
              }`}
              aria-label="Status"
              aria-current={activeTab === 'status' ? 'page' : undefined}
            >
              <Circle
                className={`w-4 h-4 transition-all duration-300 ${
                  activeTab === 'status' ? 'fill-white' : ''
                }`}
                strokeWidth={2.5}
              />
              <span className="text-[9px] font-medium mt-0.5">Status</span>
            </button>

            <button
              onClick={() => setActiveTab('groups')}
              className={`flex flex-col items-center gap-0.5 px-2 sm:px-3 py-2 rounded-xl transition-all duration-300 transform ${
                activeTab === 'groups'
                  ? 'bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/40 scale-105'
                  : 'text-slate-500 hover:text-violet-600 hover:bg-white/60 hover:scale-105 active:scale-95'
              }`}
              aria-label="Groups"
              aria-current={activeTab === 'groups' ? 'page' : undefined}
            >
              <UsersRound
                className={`w-4 h-4 transition-all duration-300 ${
                  activeTab === 'groups' ? 'fill-white' : ''
                }`}
                strokeWidth={2.5}
              />
              <span className="text-[9px] font-medium mt-0.5">Groups</span>
            </button>

            <button
              onClick={() => setActiveTab('discover')}
              className={`flex flex-col items-center gap-0.5 px-2 sm:px-3 py-2 rounded-xl transition-all duration-300 transform ${
                activeTab === 'discover'
                  ? 'bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/40 scale-105'
                  : 'text-slate-500 hover:text-violet-600 hover:bg-white/60 hover:scale-105 active:scale-95'
              }`}
              aria-label="Discover"
              aria-current={activeTab === 'discover' ? 'page' : undefined}
            >
              <Compass
                className={`w-4 h-4 transition-all duration-300 ${
                  activeTab === 'discover' ? 'fill-white' : ''
                }`}
                strokeWidth={2.5}
              />
              <span className="text-[9px] font-medium mt-0.5">Discover</span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`flex flex-col items-center gap-0.5 px-2 sm:px-3 py-2 rounded-xl transition-all duration-300 transform ${
                activeTab === 'history'
                  ? 'bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/40 scale-105'
                  : 'text-slate-500 hover:text-violet-600 hover:bg-white/60 hover:scale-105 active:scale-95'
              }`}
              aria-label="History"
              aria-current={activeTab === 'history' ? 'page' : undefined}
            >
              <Clock
                className={`w-4 h-4 transition-all duration-300 ${
                  activeTab === 'history' ? 'fill-white' : ''
                }`}
                strokeWidth={2.5}
              />
              <span className="text-[9px] font-medium mt-0.5">History</span>
            </button>
          </div>
        </nav>
      )}

      {/* Call Modal */}
      {callState.active && (
        <Suspense fallback={null}>
          <CallModal
            currentUser={currentUser}
            calleeId={callState.calleeId}
            callType={callState.callType}
            incomingCall={callState.incomingCall}
            onClose={handleCloseCall}
          />
        </Suspense>
      )}

      {/* Profile Preview — overlays whatever screen is open */}
      {viewProfile && (
        <Suspense fallback={null}>
          <ProfileView
            currentUser={currentUser}
            userId={viewProfile.userId}
            initialProfile={viewProfile.initialProfile}
            onClose={handleCloseProfileView}
            onMessage={handleOpenChat}
            onCall={handleCall}
            onChanged={handleProfileRelationChanged}
          />
        </Suspense>
      )}
    </div>
  );
}

/** Mounts the toast notification system alongside the app, regardless of which screen is active. */
export default function AppRoot() {
  return (
    <>
      <App />
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{
          style: { borderRadius: '1rem' },
        }}
      />
    </>
  );
}
