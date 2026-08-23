/**
 * NChat Type Definitions
 * Production-ready types for the messaging application
 */

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  username?: string;
  username_last_changed?: string;
  avatar_url?: string;
  bio?: string;
  last_seen?: string;
  is_online?: boolean;
  blocked_users?: string[];
  is_admin?: boolean;
  created_at?: string;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  fileName?: string;
  fileSize?: string;
  duration?: string;
  type: MessageType;
  created_at: string;
  is_encrypted?: boolean;
  is_read?: boolean;
  reply_to?: string;
  replied_to_id?: string;
  is_deleted?: boolean;
  deleted_for?: string[];
  reactions?: { [emoji: string]: string[] };
  client_message_id?: string;
  chat_room_id?: string;
  media_url?: string;
  thumbnail_url?: string;
  is_edited?: boolean;
  edited_at?: string;
  // Location data
  latitude?: number;
  longitude?: number;
  location_address?: string;
  // Contact data
  shared_contact_id?: string;
  shared_contact_name?: string;
  shared_contact_avatar?: string;
  // GIF data
  gif_url?: string;
  gif_preview_url?: string;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'file'
  | 'gif'
  | 'location'
  | 'contact'
  | 'sticker'
  | 'video_call'
  | 'voice_call'
  | 'friend_request'
  | 'friend_accept'
  | 'friend_cancel'
  | 'friend_decline'
  | 'system';

export interface Contact {
  user_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  profile: UserProfile;
  lastMessage?: Message;
  unreadCount?: number;
}

export interface ChatSession {
  contact: UserProfile;
  lastMessage?: Message;
  unreadCount: number;
}

export interface ChatRoom {
  id: string;
  name?: string;
  is_group: boolean;
  created_by?: string;
  created_at: string;
  members?: ChatMember[];
}

export interface ChatMember {
  id: string;
  chat_id: string;
  user_id: string;
  joined_at: string;
  profile?: UserProfile;
}

export interface CallSignal {
  type: 'offer' | 'answer' | 'candidate' | 'end';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  caller_id: string;
  call_type: 'audio' | 'video';
  call_id?: string;
}

export interface Call {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: 'audio' | 'video';
  status: 'initiated' | 'ringing' | 'answered' | 'ended' | 'missed' | 'declined';
  duration?: number;
  created_at: string;
  ended_at?: string;
  offer_sdp?: RTCSessionDescriptionInit;
  answer_sdp?: RTCSessionDescriptionInit;
}

export interface CallHistory {
  id: string;
  caller_id: string;
  callee_id: string;
  call_type: 'voice' | 'video';
  status: 'missed' | 'answered' | 'declined';
  duration?: number;
  started_at: string;
  ended_at?: string;
  caller_profile?: UserProfile;
  callee_profile?: UserProfile;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  avatar_url?: string;
  created_by: string;
  created_at: string;
  is_muted?: boolean;
  updated_at?: string;
}

export interface GroupMember {
  id?: string;
  group_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  profile?: UserProfile;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  type?: MessageType;
  created_at: string;
  is_read?: boolean;
  reply_to?: string;
  is_deleted?: boolean;
  deleted_for?: string[];
  reactions?: { [emoji: string]: string[] };
  client_message_id?: string;
  sender_profile?: UserProfile;
  is_edited?: boolean;
  edited_at?: string;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  updated_at: string;
  sender_profile?: UserProfile;
  receiver_profile?: UserProfile;
}

export interface Friendship {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  actor_id?: string;
  type: NotificationType;
  payload?: Record<string, any>;
  is_read: boolean;
  created_at: string;
  actor?: UserProfile;
}

export type NotificationType =
  | 'friend_request'
  | 'friend_accept'
  | 'new_message'
  | 'incoming_call'
  | 'missed_call'
  | 'group_invite'
  | 'mention'
  | 'system';

export interface NotificationSettings {
  user_id: string;
  push_enabled: boolean;
  message_notifications: boolean;
  call_notifications: boolean;
  show_preview: boolean;
  muted_until?: string;
}

export interface MediaAttachment {
  id: string;
  message_id?: string;
  group_message_id?: string;
  uploader_id: string;
  file_path: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
  thumbnail_path?: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
  created_at: string;
}

export interface BlockedUser {
  id: string;
  user_id: string;
  blocked_user_id: string;
  blocked_at: string;
}

export interface PinnedChat {
  id: string;
  user_id: string;
  chat_id: string;
  pinned_at: string;
}

export interface ArchivedChat {
  id: string;
  user_id: string;
  chat_id: string;
  archived_at: string;
}

export interface DeviceToken {
  id: string;
  user_id: string;
  device_token: string;
  created_at: string;
}

export interface MessageRead {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  reaction: string;
  reacted_at: string;
}

export interface TypingIndicator {
  user_id: string;
  chat_id: string;
  is_typing: boolean;
  timestamp: string;
}

export interface PresenceState {
  user_id: string;
  online_at: string;
  status?: 'online' | 'away' | 'busy';
}

// ============================================
// STATUS/STORIES TYPES (WhatsApp-style)
// ============================================

export interface Status {
  id: string;
  user_id: string;
  content_type: StatusContentType;
  content_url?: string;        // For image/video
  text_content?: string;       // For text status
  background_color?: string;   // For text status background
  font_style?: string;         // For text status font
  thumbnail_url?: string;      // Video thumbnail
  duration?: number;           // Video duration in seconds
  caption?: string;            // Caption for media
  created_at: string;
  expires_at: string;          // 24 hours from creation
  view_count: number;
  is_muted?: boolean;
  privacy: StatusPrivacy;
}

export type StatusContentType = 'text' | 'image' | 'video';

export type StatusPrivacy = 'everyone' | 'contacts' | 'contacts_except' | 'only_share_with';

export interface StatusView {
  id: string;
  status_id: string;
  viewer_id: string;
  viewed_at: string;
  viewer_profile?: UserProfile;
}

export interface StatusReply {
  id: string;
  status_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender_profile?: UserProfile;
}

export interface UserStatuses {
  user_id: string;
  user_profile: UserProfile;
  statuses: Status[];
  hasUnviewed: boolean;
  lastStatusAt: string;
}

export interface StatusPrivacySettings {
  user_id: string;
  default_privacy: StatusPrivacy;
  excluded_contacts: string[];   // For contacts_except
  included_contacts: string[];   // For only_share_with
  hide_from: string[];           // Muted status from these users
}
