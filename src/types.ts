export interface UserProfile {
  id: string;
  full_name: string;
  username?: string;
  email: string;
  avatar_url?: string;
  bio?: string;
  is_online?: boolean;
  last_seen?: string;
}

export interface Contact {
  user_id: string;
  status: string;
  profile: UserProfile;
  lastMessage?: Message | null;
  unreadCount?: number;
}

export interface Message {
  id: string;
  client_message_id?: string;
  sender_id: string;
  receiver_id?: string;
  content: string;
  type: 'text' | 'image' | 'voice' | 'video' | 'file' | 'gif' | 'location';
  created_at: string;
  is_read: boolean;
  is_deleted?: boolean;
  is_edited?: boolean;
  edited_at?: string;
  reactions?: Record<string, string[]>;
  syncStatus?: 'pending' | 'sent' | 'failed';
}

export interface GroupMessage {
  id: string;
  client_message_id?: string;
  sender_id: string;
  conversation_id: string;
  content: string;
  type?: 'text' | 'image' | 'voice' | 'video' | 'file';
  created_at: string;
  is_read: boolean;
  is_deleted?: boolean;
  is_edited?: boolean;
  edited_at?: string;
  reactions?: Record<string, string[]>;
  syncStatus?: 'pending' | 'sent' | 'failed';
  sender_profile?: UserProfile;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  sender_profile?: UserProfile;
  created_at: string;
}

export interface Call {
  id: string;
  caller_id: string;
  receiver_id?: string;
  call_type: 'audio' | 'video';
  status: string;
  created_at: string;
  offer_sdp?: RTCSessionDescriptionInit;
}

export interface CallSignal {
  id: string;
  call_id: string;
  from_id: string;
  to_id?: string;
  kind: string;
  payload: string;
  created_at: string;
}

export interface Status {
  id: string;
  user_id: string;
  content_type: 'text' | 'image' | 'video';
  text_content?: string;
  content_url?: string;
  background_color?: string;
  font_style?: string;
  caption?: string;
  view_count: number;
  created_at: string;
  duration?: number;
}

export interface UserStatuses {
  user_id: string;
  user_profile: UserProfile;
  statuses: Status[];
  hasUnviewed: boolean;
  lastStatusAt: string;
}

export interface StatusView {
  id: string;
  viewer_profile?: UserProfile;
  viewed_at: string;
}
