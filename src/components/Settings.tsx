import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  User,
  Bell,
  Lock,
  HelpCircle,
  LogOut,
  ChevronRight,
  Camera,
  Edit2,
  Check,
  X,
  UserX,
  Shield,
  Users,
  Database,
  Activity,
  Globe,
  Palette,
  MessageCircle,
  Info
} from 'lucide-react';
import { UserProfile } from '../types';
import { authService } from '../services/authService';
import { profileService } from '../services/profileService';
import { privacyService, PrivacySettings, PrivacyOption } from '../services/privacyService';
import { friendService } from '../services/friendService';
import { mediaService } from '../services/mediaService';
import { supabase } from '../supabaseClient';
import { ImageCropper } from './ImageCropper';

interface SettingsProps {
  currentUser: UserProfile;
  onBack: () => void;
  onLogout: () => void;
  onProfileUpdate: (profile: UserProfile) => void;
}

type SettingsSection = 'main' | 'profile' | 'privacy' | 'notifications' | 'blocked' | 'admin';

// Admin email for developer access
const ADMIN_EMAIL = 'kazmiinasir6@gmail.com';

// Check if current user is admin
const isAdmin = (email: string) => email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

/** Renders an avatar image, falling back to an initial if there's no URL or the image fails to load. */
function AvatarOrInitial({ src, alt, initial }: { src?: string | null; alt: string; initial: string }) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return <span>{initial}</span>;
  }

  return <img src={src} alt={alt} onError={() => setBroken(true)} />;
}

export function Settings({ currentUser, onBack, onLogout, onProfileUpdate }: SettingsProps) {
  const [section, setSection] = useState<SettingsSection>('main');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Profile editing state
  const [editingName, setEditingName] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [name, setName] = useState(currentUser.full_name || '');
  const [bio, setBio] = useState(currentUser.bio || '');

  // Image cropper state
  const [showCropper, setShowCropper] = useState(false);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);

  // Privacy settings state
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings | null>(null);

  // Blocked users state
  const [blockedUsers, setBlockedUsers] = useState<UserProfile[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [unblockingUser, setUnblockingUser] = useState<string | null>(null);

  // Admin stats state
  const [adminStats, setAdminStats] = useState({
    totalUsers: 0,
    onlineUsers: 0,
    totalMessages: 0,
    totalGroups: 0,
    loadingStats: true
  });

  // Load privacy settings
  useEffect(() => {
    const loadPrivacy = async () => {
      const result = await privacyService.getSettings(currentUser.id);
      if (result.success && result.data) {
        setPrivacySettings(result.data);
      }
    };
    loadPrivacy();
  }, [currentUser.id]);

  // Load blocked users when blocked section is opened
  useEffect(() => {
    if (section === 'blocked') {
      const loadBlockedUsers = async () => {
        setLoadingBlocked(true);
        try {
          const result = await friendService.getBlockedUsers(currentUser.id);
          if (result.success && result.data) {
            setBlockedUsers(result.data);
          }
        } catch (error) {
          console.error('Error loading blocked users:', error);
        } finally {
          setLoadingBlocked(false);
        }
      };
      loadBlockedUsers();
    }
  }, [section, currentUser.id]);

  // Load admin stats when admin panel is opened
  useEffect(() => {
    if (section === 'admin' && isAdmin(currentUser.email)) {
      const loadStats = async () => {
        try {
          const { count: usersCount } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

          const { count: onlineCount } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .eq('is_online', true);

          const { count: messagesCount } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true });

          const { count: groupsCount } = await supabase
            .from('groups')
            .select('*', { count: 'exact', head: true });

          setAdminStats({
            totalUsers: usersCount || 0,
            onlineUsers: onlineCount || 0,
            totalMessages: messagesCount || 0,
            totalGroups: groupsCount || 0,
            loadingStats: false
          });
        } catch (error) {
          console.error('Error loading admin stats:', error);
          setAdminStats(prev => ({ ...prev, loadingStats: false }));
        }
      };
      loadStats();
    }
  }, [section, currentUser.email]);

  // Handle image selection for cropping
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCropImageUrl(reader.result as string);
      setShowCropper(true);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Handle cropped image upload
  const handleCroppedImage = async (blob: Blob) => {
    setShowCropper(false);
    setCropImageUrl(null);
    setSaving(true);

    try {
      const file = new File([blob], `avatar_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const result = await mediaService.uploadAvatar(file, currentUser.id);

      if (!result.success || !result.url) {
        toast.error(result.error || 'Failed to upload photo. Please try again.');
        return;
      }

      const updateResult = await profileService.updateProfile(currentUser.id, {
        avatar_url: result.url
      });

      if (!updateResult.success) {
        toast.error(updateResult.error || 'Photo uploaded but could not be saved to your profile.');
        return;
      }

      const updatedProfile = await profileService.getProfile(currentUser.id);
      if (updatedProfile) {
        onProfileUpdate(updatedProfile);
      }
      toast.success('Profile photo updated');
    } catch (error: any) {
      console.error('Error updating avatar:', error);
      toast.error(error?.message || 'Something went wrong while updating your photo.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveName = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const result = await profileService.updateProfile(currentUser.id, {
        full_name: name.trim()
      });
      if (result.success) {
        const updatedProfile = await profileService.getProfile(currentUser.id);
        if (updatedProfile) {
          onProfileUpdate(updatedProfile);
        }
        setEditingName(false);
      }
    } catch (error) {
      console.error('Error updating name:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBio = async () => {
    setSaving(true);
    try {
      const result = await profileService.updateProfile(currentUser.id, {
        bio: bio.trim()
      });
      if (result.success) {
        const updatedProfile = await profileService.getProfile(currentUser.id);
        if (updatedProfile) {
          onProfileUpdate(updatedProfile);
        }
        setEditingBio(false);
      }
    } catch (error) {
      console.error('Error updating bio:', error);
    } finally {
      setSaving(false);
    }
  };

  const handlePrivacyChange = async (key: keyof PrivacySettings, value: PrivacyOption | boolean) => {
    if (!privacySettings) return;

    const updated = { ...privacySettings, [key]: value };
    setPrivacySettings(updated);

    await privacyService.updateSettings(currentUser.id, { [key]: value });
  };

  const handleLogout = async () => {
    setLoading(true);
    await authService.logout();
    onLogout();
  };

  const handleUnblockUser = async (blockedUserId: string) => {
    setUnblockingUser(blockedUserId);
    try {
      const result = await friendService.unblockUser(currentUser.id, blockedUserId);
      if (result.success) {
        setBlockedUsers(prev => prev.filter(u => u.id !== blockedUserId));
      }
    } catch (error) {
      console.error('Error unblocking user:', error);
    } finally {
      setUnblockingUser(null);
    }
  };

  const renderPrivacyOption = (
    label: string,
    value: PrivacyOption,
    onChange: (value: PrivacyOption) => void
  ) => (
    <div className="settings-item">
      <span className="settings-item-label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PrivacyOption)}
        className="settings-select"
      >
        <option value="everyone">Everyone</option>
        <option value="contacts">My Contacts</option>
        <option value="nobody">Nobody</option>
      </select>
    </div>
  );

  const renderToggle = (
    enabled: boolean,
    onChange: (value: boolean) => void
  ) => (
    <button
      onClick={() => onChange(!enabled)}
      className={`settings-toggle ${enabled ? 'active' : ''}`}
    >
      <div className="settings-toggle-knob" />
    </button>
  );

  // Image Cropper Modal
  if (showCropper && cropImageUrl) {
    return (
      <ImageCropper
        imageUrl={cropImageUrl}
        onCrop={handleCroppedImage}
        onCancel={() => {
          setShowCropper(false);
          setCropImageUrl(null);
        }}
      />
    );
  }

  // Main Settings Menu
  if (section === 'main') {
    return (
      <div className="settings-container">
        {/* Header with gradient and profile */}
        <div className="settings-header">
          <div className="settings-header-top">
            <button onClick={onBack} className="settings-back-btn">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="settings-title">Settings</h1>
            <div className="w-9" /> {/* Spacer for alignment */}
          </div>

          {/* Profile Card */}
          <button onClick={() => setSection('profile')} className="settings-profile-card">
            <div className="settings-avatar">
              <AvatarOrInitial
                key={currentUser.avatar_url || 'none'}
                src={currentUser.avatar_url}
                alt=""
                initial={currentUser.full_name?.charAt(0) || '?'}
              />
            </div>
            <div className="settings-profile-info">
              <h2>{currentUser.full_name}</h2>
              <p>{currentUser.bio || 'Add a status'}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-white/60" />
          </button>
        </div>

        {/* Menu Items */}
        <div className="settings-content">
          <div className="settings-section">
            <button onClick={() => setSection('profile')} className="settings-menu-item">
              <div className="settings-menu-icon purple">
                <User className="w-5 h-5" />
              </div>
              <div className="settings-menu-text">
                <span className="settings-menu-title">Account</span>
                <span className="settings-menu-subtitle">Profile, username, email</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>

            <button onClick={() => setSection('privacy')} className="settings-menu-item">
              <div className="settings-menu-icon green">
                <Lock className="w-5 h-5" />
              </div>
              <div className="settings-menu-text">
                <span className="settings-menu-title">Privacy</span>
                <span className="settings-menu-subtitle">Last seen, profile photo</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>

            <button onClick={() => setSection('notifications')} className="settings-menu-item">
              <div className="settings-menu-icon orange">
                <Bell className="w-5 h-5" />
              </div>
              <div className="settings-menu-text">
                <span className="settings-menu-title">Notifications</span>
                <span className="settings-menu-subtitle">Messages, calls, sounds</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>

            <button onClick={() => setSection('blocked')} className="settings-menu-item">
              <div className="settings-menu-icon red">
                <UserX className="w-5 h-5" />
              </div>
              <div className="settings-menu-text">
                <span className="settings-menu-title">Blocked Users</span>
                <span className="settings-menu-subtitle">Manage blocked contacts</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="settings-section">
            <button className="settings-menu-item">
              <div className="settings-menu-icon blue">
                <MessageCircle className="w-5 h-5" />
              </div>
              <div className="settings-menu-text">
                <span className="settings-menu-title">Chats</span>
                <span className="settings-menu-subtitle">Theme, wallpapers, chat history</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>

            <button className="settings-menu-item">
              <div className="settings-menu-icon teal">
                <Palette className="w-5 h-5" />
              </div>
              <div className="settings-menu-text">
                <span className="settings-menu-title">Appearance</span>
                <span className="settings-menu-subtitle">Theme, dark mode</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>

            <button className="settings-menu-item">
              <div className="settings-menu-icon indigo">
                <Globe className="w-5 h-5" />
              </div>
              <div className="settings-menu-text">
                <span className="settings-menu-title">Language</span>
                <span className="settings-menu-subtitle">English</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="settings-section">
            <button className="settings-menu-item">
              <div className="settings-menu-icon cyan">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div className="settings-menu-text">
                <span className="settings-menu-title">Help</span>
                <span className="settings-menu-subtitle">FAQ, contact us, privacy policy</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>

            <button className="settings-menu-item">
              <div className="settings-menu-icon gray">
                <Info className="w-5 h-5" />
              </div>
              <div className="settings-menu-text">
                <span className="settings-menu-title">About</span>
                <span className="settings-menu-subtitle">Version 2.0.0</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>

            {/* Admin Panel - Only for admin */}
            {isAdmin(currentUser.email) && (
              <button onClick={() => setSection('admin')} className="settings-menu-item">
                <div className="settings-menu-icon admin">
                  <Shield className="w-5 h-5" />
                </div>
                <div className="settings-menu-text">
                  <span className="settings-menu-title admin-text">Admin Panel</span>
                  <span className="settings-menu-subtitle">Developer controls</span>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>
            )}
          </div>

          {/* Logout Button */}
          <button onClick={handleLogout} disabled={loading} className="settings-logout-btn">
            <LogOut className={`w-5 h-5 ${loading ? 'opacity-50' : ''}`} />
            <span>Log Out</span>
          </button>

          {/* Footer */}
          <p className="settings-footer">NChat v2.0.0</p>
        </div>

        <style>{settingsStyles}</style>
      </div>
    );
  }

  // Profile Section
  if (section === 'profile') {
    return (
      <div className="settings-container">
        <div className="settings-subheader">
          <button onClick={() => setSection('main')} className="settings-back-btn dark">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1>Profile</h1>
        </div>

        <div className="settings-content">
          {/* Avatar Section */}
          <div className="profile-avatar-section">
            <div className="profile-avatar-wrapper">
              <div className="profile-avatar-large">
                <AvatarOrInitial
                  key={currentUser.avatar_url || 'none'}
                  src={currentUser.avatar_url}
                  alt=""
                  initial={currentUser.full_name?.charAt(0) || '?'}
                />
              </div>
              <label className="profile-camera-btn">
                <Camera className={`w-5 h-5 ${saving ? 'opacity-50' : ''}`} />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  disabled={saving}
                />
              </label>
            </div>
          </div>

          {/* Profile Info */}
          <div className="settings-section">
            {/* Name */}
            <div className="profile-field">
              <div className="profile-field-icon">
                <User className="w-5 h-5" />
              </div>
              <div className="profile-field-content">
                <span className="profile-field-label">Name</span>
                {editingName ? (
                  <div className="profile-field-edit">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                    />
                    <button onClick={handleSaveName} disabled={saving} className="save-btn">
                      <Check className={`w-4 h-4 ${saving ? 'opacity-50' : ''}`} />
                    </button>
                    <button onClick={() => { setEditingName(false); setName(currentUser.full_name || ''); }} className="cancel-btn">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="profile-field-value">
                    <span>{currentUser.full_name}</span>
                    <button onClick={() => setEditingName(true)}>
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Bio */}
            <div className="profile-field">
              <div className="profile-field-icon">
                <Edit2 className="w-5 h-5" />
              </div>
              <div className="profile-field-content">
                <span className="profile-field-label">About</span>
                {editingBio ? (
                  <div className="profile-field-edit">
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      maxLength={150}
                      rows={2}
                      autoFocus
                    />
                    <div className="edit-actions">
                      <span className="char-count">{bio.length}/150</span>
                      <button onClick={handleSaveBio} disabled={saving} className="save-btn small">
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => { setEditingBio(false); setBio(currentUser.bio || ''); }} className="cancel-btn small">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="profile-field-value">
                    <span>{currentUser.bio || 'Add a bio'}</span>
                    <button onClick={() => setEditingBio(true)}>
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Username */}
            <div className="profile-field">
              <div className="profile-field-icon">
                <span>@</span>
              </div>
              <div className="profile-field-content">
                <span className="profile-field-label">Username</span>
                <div className="profile-field-value">
                  <span>{currentUser.username || 'Not set'}</span>
                </div>
              </div>
            </div>

            {/* Email */}
            <div className="profile-field">
              <div className="profile-field-icon">
                <Lock className="w-5 h-5" />
              </div>
              <div className="profile-field-content">
                <span className="profile-field-label">Email</span>
                <div className="profile-field-value">
                  <span>{currentUser.email}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <style>{settingsStyles}</style>
      </div>
    );
  }

  // Privacy Section
  if (section === 'privacy') {
    return (
      <div className="settings-container">
        <div className="settings-subheader">
          <button onClick={() => setSection('main')} className="settings-back-btn dark">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1>Privacy</h1>
        </div>

        <div className="settings-content">
          {privacySettings && (
            <>
              <div className="settings-section-title">Who can see my info</div>
              <div className="settings-section">
                {renderPrivacyOption('Last Seen', privacySettings.last_seen, (v) => handlePrivacyChange('last_seen', v))}
                {renderPrivacyOption('Profile Photo', privacySettings.profile_photo, (v) => handlePrivacyChange('profile_photo', v))}
                {renderPrivacyOption('About', privacySettings.about, (v) => handlePrivacyChange('about', v))}
              </div>

              <div className="settings-section-title">Other</div>
              <div className="settings-section">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <span className="settings-item-label">Read Receipts</span>
                    <span className="settings-item-desc">Show when you've read messages</span>
                  </div>
                  {renderToggle(privacySettings.read_receipts, (v) => handlePrivacyChange('read_receipts', v))}
                </div>

                <div className="settings-item">
                  <div className="settings-item-info">
                    <span className="settings-item-label">Online Status</span>
                    <span className="settings-item-desc">Show when you're online</span>
                  </div>
                  {renderToggle(privacySettings.online_status, (v) => handlePrivacyChange('online_status', v))}
                </div>
              </div>
            </>
          )}
        </div>

        <style>{settingsStyles}</style>
      </div>
    );
  }

  // Notifications Section
  if (section === 'notifications') {
    return (
      <div className="settings-container">
        <div className="settings-subheader">
          <button onClick={() => setSection('main')} className="settings-back-btn dark">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1>Notifications</h1>
        </div>

        <div className="settings-content">
          <div className="settings-section-title">Messages</div>
          <div className="settings-section">
            <div className="settings-item">
              <span className="settings-item-label">Message Notifications</span>
              {renderToggle(true, () => {})}
            </div>
            <div className="settings-item">
              <span className="settings-item-label">Show Preview</span>
              {renderToggle(true, () => {})}
            </div>
            <div className="settings-item">
              <span className="settings-item-label">Sound</span>
              {renderToggle(true, () => {})}
            </div>
            <div className="settings-item">
              <span className="settings-item-label">Vibrate</span>
              {renderToggle(true, () => {})}
            </div>
          </div>

          <div className="settings-section-title">Calls</div>
          <div className="settings-section">
            <div className="settings-item">
              <span className="settings-item-label">Call Notifications</span>
              {renderToggle(true, () => {})}
            </div>
            <div className="settings-item">
              <span className="settings-item-label">Ringtone</span>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        </div>

        <style>{settingsStyles}</style>
      </div>
    );
  }

  // Blocked Users Section
  if (section === 'blocked') {
    return (
      <div className="settings-container">
        <div className="settings-subheader">
          <button onClick={() => setSection('main')} className="settings-back-btn dark">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1>Blocked Users</h1>
        </div>

        <div className="settings-content">
          {loadingBlocked ? (
            <div className="settings-empty">
              <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center animate-pulse">
                <UserX className="w-5 h-5 text-violet-500" />
              </div>
              <p className="settings-empty-text" style={{ marginTop: '12px' }}>Loading...</p>
            </div>
          ) : blockedUsers.length === 0 ? (
            <div className="settings-empty">
              <div className="settings-empty-icon">
                <UserX className="w-8 h-8" />
              </div>
              <p className="settings-empty-title">No blocked users</p>
              <p className="settings-empty-text">Blocked users won't be able to message or call you</p>
            </div>
          ) : (
            <div className="settings-section">
              <p className="blocked-users-hint">
                Blocked users cannot send you messages or call you. Unblock to restore communication.
              </p>
              {blockedUsers.map((user) => (
                <div key={user.id} className="blocked-user-item">
                  <div className="blocked-user-avatar">
                    <AvatarOrInitial
                      key={user.avatar_url || 'none'}
                      src={user.avatar_url}
                      alt={user.full_name}
                      initial={user.full_name?.charAt(0).toUpperCase() || '?'}
                    />
                  </div>
                  <div className="blocked-user-info">
                    <span className="blocked-user-name">{user.full_name}</span>
                    <span className="blocked-user-username">@{user.username || 'user'}</span>
                  </div>
                  <button
                    onClick={() => handleUnblockUser(user.id)}
                    disabled={unblockingUser === user.id}
                    className="unblock-btn"
                  >
                    {unblockingUser === user.id ? '...' : 'Unblock'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <style>{settingsStyles}</style>
      </div>
    );
  }

  // Admin Panel Section
  if (section === 'admin' && isAdmin(currentUser.email)) {
    return (
      <div className="settings-container">
        <div className="settings-subheader admin">
          <button onClick={() => setSection('main')} className="settings-back-btn">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Shield className="w-5 h-5" />
          <h1>Admin Panel</h1>
        </div>

        <div className="settings-content">
          {/* Admin Badge */}
          <div className="admin-badge">
            <div className="admin-badge-avatar">
              <AvatarOrInitial
                key={currentUser.avatar_url || 'none'}
                src={currentUser.avatar_url}
                alt=""
                initial={currentUser.full_name?.charAt(0) || '?'}
              />
            </div>
            <div className="admin-badge-info">
              <div className="admin-badge-name">
                <span>{currentUser.full_name}</span>
                <span className="dev-tag">DEV</span>
              </div>
              <span className="admin-badge-email">{currentUser.email}</span>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="admin-stats">
            <div className="admin-stat-card">
              <div className="admin-stat-icon blue">
                <Users className="w-4 h-4" />
              </div>
              <span className="admin-stat-label">Total Users</span>
              <span className="admin-stat-value">
                {adminStats.loadingStats ? '...' : adminStats.totalUsers}
              </span>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-icon green">
                <Activity className="w-4 h-4" />
              </div>
              <span className="admin-stat-label">Online</span>
              <span className="admin-stat-value">
                {adminStats.loadingStats ? '...' : adminStats.onlineUsers}
              </span>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-icon purple">
                <Database className="w-4 h-4" />
              </div>
              <span className="admin-stat-label">Messages</span>
              <span className="admin-stat-value">
                {adminStats.loadingStats ? '...' : adminStats.totalMessages.toLocaleString()}
              </span>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-icon orange">
                <Users className="w-4 h-4" />
              </div>
              <span className="admin-stat-label">Groups</span>
              <span className="admin-stat-value">
                {adminStats.loadingStats ? '...' : adminStats.totalGroups}
              </span>
            </div>
          </div>

          {/* System Info */}
          <div className="settings-section-title">System Info</div>
          <div className="settings-section">
            <div className="settings-item">
              <span className="settings-item-label">App Version</span>
              <span className="settings-item-value">v2.0.0</span>
            </div>
            <div className="settings-item">
              <span className="settings-item-label">React</span>
              <span className="settings-item-value">18.3.1</span>
            </div>
            <div className="settings-item">
              <span className="settings-item-label">Build</span>
              <span className="settings-item-value">Production</span>
            </div>
          </div>
        </div>

        <style>{settingsStyles}</style>
      </div>
    );
  }

  return null;
}

const settingsStyles = `
  .settings-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: transparent;
  }

  /* Header Styles */
  .settings-header {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.95) 0%, rgba(168, 85, 247, 0.95) 50%, rgba(217, 70, 239, 0.95) 100%);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    padding: 16px;
    padding-top: max(16px, env(safe-area-inset-top));
    box-shadow: 0 4px 20px rgba(139, 92, 246, 0.25);
  }

  .settings-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .settings-back-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }

  .settings-back-btn:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .settings-back-btn.dark {
    background: rgba(255, 255, 255, 0.2);
    color: white;
  }

  .settings-back-btn.dark:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .settings-title {
    font-size: 20px;
    font-weight: 600;
    color: white;
  }

  /* Profile Card in Header */
  .settings-profile-card {
    display: flex;
    align-items: center;
    gap: 14px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 16px;
    padding: 14px;
    border: none;
    width: 100%;
    cursor: pointer;
    transition: all 0.2s;
  }

  .settings-profile-card:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  .settings-avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: linear-gradient(135deg, #c084fc 0%, #a855f7 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 2px solid rgba(255, 255, 255, 0.3);
  }

  .settings-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .settings-avatar span {
    font-size: 22px;
    font-weight: 600;
    color: white;
  }

  .settings-profile-info {
    flex: 1;
    text-align: left;
  }

  .settings-profile-info h2 {
    font-size: 17px;
    font-weight: 600;
    color: white;
    margin: 0;
  }

  .settings-profile-info p {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
    margin: 2px 0 0;
  }

  /* Content Area */
  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  /* Section Styles */
  .settings-section {
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 16px;
    overflow: hidden;
    margin-bottom: 16px;
    box-shadow: 0 2px 12px rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.7);
  }

  .settings-section-title {
    font-size: 13px;
    font-weight: 500;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 8px 4px;
    margin-bottom: 4px;
  }

  /* Menu Item Styles */
  .settings-menu-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    border: none;
    background: transparent;
    width: 100%;
    cursor: pointer;
    transition: background 0.2s;
    border-bottom: 1px solid #f3f4f6;
  }

  .settings-menu-item:last-child {
    border-bottom: none;
  }

  .settings-menu-item:hover {
    background: #f9fafb;
  }

  .settings-menu-item:active {
    background: #f3f4f6;
  }

  .settings-menu-icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .settings-menu-icon.purple { background: #f3e8ff; color: #9333ea; }
  .settings-menu-icon.green { background: #dcfce7; color: #16a34a; }
  .settings-menu-icon.orange { background: #ffedd5; color: #ea580c; }
  .settings-menu-icon.red { background: #fee2e2; color: #dc2626; }
  .settings-menu-icon.blue { background: #dbeafe; color: #2563eb; }
  .settings-menu-icon.teal { background: #ccfbf1; color: #0d9488; }
  .settings-menu-icon.indigo { background: #e0e7ff; color: #4f46e5; }
  .settings-menu-icon.cyan { background: #cffafe; color: #0891b2; }
  .settings-menu-icon.gray { background: #f3f4f6; color: #6b7280; }
  .settings-menu-icon.admin {
    background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
    color: white;
  }

  .settings-menu-text {
    flex: 1;
    text-align: left;
  }

  .settings-menu-title {
    display: block;
    font-size: 15px;
    font-weight: 500;
    color: #1f2937;
  }

  .settings-menu-title.admin-text {
    color: #7c3aed;
  }

  .settings-menu-subtitle {
    display: block;
    font-size: 12px;
    color: #9ca3af;
    margin-top: 2px;
  }

  /* Logout Button */
  .settings-logout-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 14px;
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 16px;
    color: #ef4444;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    margin-bottom: 16px;
  }

  .settings-logout-btn:hover {
    background: rgba(254, 242, 242, 0.9);
  }

  .settings-logout-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Footer */
  .settings-footer {
    text-align: center;
    font-size: 12px;
    color: #9ca3af;
    padding: 8px 0 24px;
  }

  /* Subheader for inner pages */
  .settings-subheader {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.95) 0%, rgba(168, 85, 247, 0.95) 50%, rgba(217, 70, 239, 0.95) 100%);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: none;
    color: white;
  }

  .settings-subheader.admin {
    background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
    color: white;
    border-bottom: none;
  }

  .settings-subheader h1 {
    font-size: 18px;
    font-weight: 600;
    color: white;
    margin: 0;
  }

  .settings-subheader.admin h1 {
    color: white;
  }

  /* Profile Section Styles */
  .profile-avatar-section {
    display: flex;
    justify-content: center;
    padding: 32px 0;
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 16px;
    margin-bottom: 16px;
  }

  .profile-avatar-wrapper {
    position: relative;
  }

  .profile-avatar-large {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.3);
  }

  .profile-avatar-large img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .profile-avatar-large span {
    font-size: 42px;
    font-weight: 600;
    color: white;
  }

  .profile-camera-btn {
    position: absolute;
    bottom: 4px;
    right: 4px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #a855f7;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    transition: all 0.2s;
  }

  .profile-camera-btn:hover {
    background: #9333ea;
    transform: scale(1.05);
  }

  .profile-camera-btn input {
    display: none;
  }

  /* Profile Field Styles */
  .profile-field {
    display: flex;
    gap: 14px;
    padding: 16px;
    border-bottom: 1px solid #f3f4f6;
  }

  .profile-field:last-child {
    border-bottom: none;
  }

  .profile-field-icon {
    width: 24px;
    color: #9ca3af;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 2px;
  }

  .profile-field-icon span {
    font-size: 18px;
    font-weight: 500;
  }

  .profile-field-content {
    flex: 1;
  }

  .profile-field-label {
    display: block;
    font-size: 12px;
    color: #9ca3af;
    margin-bottom: 4px;
  }

  .profile-field-value {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .profile-field-value span {
    font-size: 15px;
    color: #1f2937;
  }

  .profile-field-value button {
    padding: 6px;
    background: transparent;
    border: none;
    color: #a855f7;
    cursor: pointer;
  }

  .profile-field-edit {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .profile-field-edit input,
  .profile-field-edit textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    font-size: 14px;
    background: #f9fafb;
    resize: none;
  }

  .profile-field-edit input:focus,
  .profile-field-edit textarea:focus {
    outline: none;
    border-color: #a855f7;
    box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.1);
  }

  .edit-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .char-count {
    font-size: 11px;
    color: #9ca3af;
    flex: 1;
  }

  .save-btn, .cancel-btn {
    padding: 8px 12px;
    border-radius: 8px;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .save-btn {
    background: #a855f7;
    color: white;
  }

  .cancel-btn {
    background: #f3f4f6;
    color: #6b7280;
  }

  .save-btn.small, .cancel-btn.small {
    padding: 6px 12px;
  }

  /* Settings Item */
  .settings-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid #f3f4f6;
  }

  .settings-item:last-child {
    border-bottom: none;
  }

  .settings-item-info {
    flex: 1;
  }

  .settings-item-label {
    font-size: 14px;
    color: #374151;
  }

  .settings-item-desc {
    display: block;
    font-size: 12px;
    color: #9ca3af;
    margin-top: 2px;
  }

  .settings-item-value {
    font-size: 14px;
    color: #6b7280;
  }

  .settings-select {
    padding: 8px 12px;
    border-radius: 8px;
    background: #f3f4f6;
    border: none;
    font-size: 13px;
    color: #374151;
    cursor: pointer;
  }

  .settings-select:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.3);
  }

  /* Toggle */
  .settings-toggle {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: #e5e7eb;
    border: none;
    padding: 2px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .settings-toggle.active {
    background: #a855f7;
  }

  .settings-toggle-knob {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: transform 0.2s;
  }

  .settings-toggle.active .settings-toggle-knob {
    transform: translateX(20px);
  }

  /* Empty State */
  .settings-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
  }

  .settings-empty-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #f3f4f6;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #9ca3af;
    margin-bottom: 16px;
  }

  .settings-empty-title {
    font-size: 15px;
    font-weight: 500;
    color: #374151;
    margin: 0 0 4px;
  }

  .settings-empty-text {
    font-size: 13px;
    color: #9ca3af;
    text-align: center;
    margin: 0;
  }

  /* Admin Styles */
  .admin-badge {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(124, 58, 237, 0.1) 100%);
    border: 1px solid rgba(168, 85, 247, 0.2);
    border-radius: 16px;
    margin-bottom: 16px;
  }

  .admin-badge-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    overflow: hidden;
    background: #a855f7;
  }

  .admin-badge-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .admin-badge-avatar span {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 600;
  }

  .admin-badge-info {
    flex: 1;
  }

  .admin-badge-name {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .admin-badge-name span:first-child {
    font-size: 15px;
    font-weight: 500;
    color: #1f2937;
  }

  .dev-tag {
    padding: 2px 8px;
    background: #a855f7;
    color: white;
    font-size: 10px;
    font-weight: 700;
    border-radius: 10px;
  }

  .admin-badge-email {
    font-size: 12px;
    color: #6b7280;
  }

  .admin-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }

  .admin-stat-card {
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 12px;
    padding: 16px;
  }

  .admin-stat-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
  }

  .admin-stat-icon.blue { background: #dbeafe; color: #2563eb; }
  .admin-stat-icon.green { background: #dcfce7; color: #16a34a; }
  .admin-stat-icon.purple { background: #f3e8ff; color: #9333ea; }
  .admin-stat-icon.orange { background: #ffedd5; color: #ea580c; }

  .admin-stat-label {
    display: block;
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 4px;
  }

  .admin-stat-value {
    font-size: 24px;
    font-weight: 700;
    color: #1f2937;
  }

  /* Blocked Users Styles */
  .blocked-users-hint {
    font-size: 12px;
    color: #6b7280;
    padding: 12px 16px;
    margin: 0;
    border-bottom: 1px solid #f3f4f6;
  }

  .blocked-user-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid #f3f4f6;
  }

  .blocked-user-item:last-child {
    border-bottom: none;
  }

  .blocked-user-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }

  .blocked-user-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .blocked-user-avatar span {
    font-size: 16px;
    font-weight: 600;
    color: white;
  }

  .blocked-user-info {
    flex: 1;
    min-width: 0;
  }

  .blocked-user-name {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: #1f2937;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .blocked-user-username {
    display: block;
    font-size: 12px;
    color: #9ca3af;
    margin-top: 2px;
  }

  .unblock-btn {
    padding: 8px 16px;
    background: #fee2e2;
    color: #dc2626;
    border: none;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 80px;
  }

  .unblock-btn:hover {
    background: #fecaca;
  }

  .unblock-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Mobile Responsiveness */
  @media (max-width: 480px) {
    .settings-header {
      padding: 12px;
    }

    .settings-content {
      padding: 12px;
    }

    .settings-profile-card {
      padding: 12px;
    }

    .settings-avatar {
      width: 48px;
      height: 48px;
    }

    .profile-avatar-large {
      width: 100px;
      height: 100px;
    }

    .profile-avatar-large span {
      font-size: 36px;
    }
  }
`;
