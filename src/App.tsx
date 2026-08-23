import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Circle, UsersRound, Compass, Clock } from 'lucide-react';
import { Auth } from './components/Auth';
import { ProfileSetup } from './components/ProfileSetup';
import { Chats } from './components/Chats';
import { ChatView } from './components/ChatView';
import { Status } from './components/Status';
import { Groups } from './components/Groups';
import { GroupChatView } from './components/GroupChatView';
import { CreateGroup } from './components/CreateGroup';
import { Discover } from './components/Discover';
import { History } from './components/History';
import { Settings } from './components/Settings';
import { CallModal } from './components/CallModal';
import { authService } from './services/authService';
import { profileService } from './services/profileService';
import { callService } from './services/callService';
import { GroupWithMembers } from './services/groupService';
import { UserProfile, Contact, Call } from './types';
import { api, convex } from './lib/convexClient';
import { useAppData } from './hooks/useAppData';

type AppView = 'chats' | 'status' | 'groups' | 'discover' | 'history';

interface CallState {
  active: boolean;
  calleeId?: string;
  callType: 'audio' | 'video';
  incomingCall?: Call;
}

export default function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');

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

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const authState = await authService.checkSession();
        setIsAuthenticated(authState.isAuthenticated);
        setNeedsProfileSetup(authState.needsProfileSetup);
        setCurrentUser(authState.user);

        if (authState.isAuthenticated) {
          const id = await authService.getCurrentUserId();
          setUserId(id);

          // Get email from the profile or user record
          const profile = await profileService.getProfile(id);
          if (profile?.email) {
            setUserEmail(profile.email);
          }
        }
      } catch (error) {
        console.error('Auth check error:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = authService.onAuthChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setIsAuthenticated(true);
        setUserId(session.user.id);
        setUserEmail(session.user.email || '');

        // Check profile
        const profile = await profileService.getProfile(session.user.id);
        if (profile && profile.full_name && profile.username && profile.avatar_url) {
          setCurrentUser(profile);
          setNeedsProfileSetup(false);
        } else {
          setNeedsProfileSetup(true);
        }
      } else if (event === 'SIGNED_OUT') {
        setIsAuthenticated(false);
        setCurrentUser(null);
        setNeedsProfileSetup(false);
        setUserId(null);
        setUserEmail('');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Update online status via Convex presence
  useEffect(() => {
    if (!currentUser?.id) return;

    const heartbeat = async () => {
      try {
        await convex.mutation(api.typing.upsertPresence, {});
      } catch { /* ignore */ }
    };

    heartbeat();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') heartbeat();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const interval = setInterval(heartbeat, 30000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [currentUser?.id]);

  // Subscribe to incoming calls
  useEffect(() => {
    if (!currentUser?.id) return;

    const unsubscribe = callService.subscribeToIncomingCalls(currentUser.id, (callSession) => {
      if (callSession.status === 'initiated' || callSession.status === 'ringing') {
        // Convert CallSession to Call type for the modal
        const incomingCall: Call = {
          id: callSession.id,
          caller_id: callSession.callerId,
          receiver_id: callSession.receiverId,
          call_type: callSession.callType,
          status: callSession.status,
          created_at: callSession.startedAt,
          offer_sdp: callSession.offerSdp
        };
        setCallState({
          active: true,
          callType: callSession.callType,
          incomingCall
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [currentUser?.id]);

  const handleAuthSuccess = useCallback(async () => {
    const id = await authService.getCurrentUserId();
    if (id) {
      setUserId(id);
      const profile = await profileService.getProfile(id);
      if (profile && profile.full_name && profile.username && profile.avatar_url) {
        setCurrentUser(profile);
        setNeedsProfileSetup(false);
      } else {
        setNeedsProfileSetup(true);
      }
      setIsAuthenticated(true);

      if (profile?.email) {
        setUserEmail(profile.email);
      }
    }
  }, []);

  const handleProfileComplete = useCallback((profile: UserProfile) => {
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
    setIsAuthenticated(false);
    setCurrentUser(null);
    setShowSettings(false);
  }, []);

  const handleProfileUpdate = useCallback((profile: UserProfile) => {
    setCurrentUser(profile);
  }, []);

  // Loading state - Static splash, no spinner
  if (loading) {
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

  // Auth screen
  if (!isAuthenticated) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  // Profile setup screen
  if (needsProfileSetup && userId) {
    return (
      <ProfileSetup
        userId={userId}
        email={userEmail}
        onComplete={handleProfileComplete}
      />
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
  // Preload ALL data on mount - this is the key to instant tabs
  const appData = useAppData(currentUser.id);

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
        {showSettings ? (
          <Settings
            currentUser={currentUser}
            onBack={handleCloseSettings}
            onLogout={handleLogout}
            onProfileUpdate={handleProfileUpdate}
          />
        ) : selectedChat ? (
          <ChatView
            currentUser={currentUser}
            contact={selectedChat}
            onBack={handleBackToChats}
            onCall={(type) => handleCall(selectedChat.user_id, type)}
          />
        ) : selectedGroup ? (
          <GroupChatView
            currentUser={currentUser}
            group={selectedGroup}
            onBack={handleBackFromGroup}
          />
        ) : showCreateGroup ? (
          <CreateGroup
            currentUser={currentUser}
            onBack={handleBackFromGroup}
            onGroupCreated={handleGroupCreated}
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
              />
            )}
            {activeTab === 'history' && (
              <History
                currentUser={currentUser}
                history={appData.callHistory}
                onCall={handleCall}
                onMessage={handleMessageFromHistory}
              />
            )}
          </>
        )}
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
        <CallModal
          currentUser={currentUser}
          calleeId={callState.calleeId}
          callType={callState.callType}
          incomingCall={callState.incomingCall}
          onClose={handleCloseCall}
        />
      )}
    </div>
  );
}
