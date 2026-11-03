-- NChat D1 schema (replaces Supabase/Postgres)
-- Apply with: wrangler d1 execute nchat-db --remote --file=./migrations/0001_init.sql

PRAGMA foreign_keys = ON;

-- ───────────────────────── Users & Auth ─────────────────────────
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  username TEXT UNIQUE,
  username_last_changed TEXT,
  avatar_url TEXT,
  bio TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE presence (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_active_at INTEGER NOT NULL
);

-- ───────────────────────── Friends ─────────────────────────
CREATE TABLE friend_requests (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sender_id, receiver_id)
);
CREATE INDEX idx_fr_receiver ON friend_requests(receiver_id, status);
CREATE INDEX idx_fr_sender ON friend_requests(sender_id, status);

CREATE TABLE friendships (
  id TEXT PRIMARY KEY,
  user1_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user1_id, user2_id)
);
CREATE INDEX idx_friendship_u1 ON friendships(user1_id);
CREATE INDEX idx_friendship_u2 ON friendships(user2_id);

CREATE TABLE blocked_users (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, blocked_user_id)
);

-- ───────────────────────── 1:1 messages ─────────────────────────
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  media_url TEXT,
  thumbnail_url TEXT,
  file_name TEXT,
  file_size TEXT,
  duration TEXT,
  client_message_id TEXT,
  reply_to TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_edited INTEGER NOT NULL DEFAULT 0,
  edited_at TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_for TEXT,       -- JSON array of user ids
  reactions TEXT,         -- JSON object: { emoji: [userIds] }
  latitude REAL, longitude REAL, location_address TEXT,
  shared_contact_id TEXT, shared_contact_name TEXT, shared_contact_avatar TEXT,
  gif_url TEXT, gif_preview_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_pair_a ON messages(sender_id, receiver_id, created_at);
CREATE INDEX idx_messages_pair_b ON messages(receiver_id, sender_id, created_at);
CREATE UNIQUE INDEX idx_messages_client_id ON messages(sender_id, client_message_id);

-- ───────────────────────── Groups ─────────────────────────
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- admin | member
  is_muted INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(group_id, user_id)
);
CREATE INDEX idx_gm_group ON group_members(group_id);
CREATE INDEX idx_gm_user ON group_members(user_id);

CREATE TABLE group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  media_url TEXT,
  thumbnail_url TEXT,
  client_message_id TEXT,
  reply_to TEXT,
  is_edited INTEGER NOT NULL DEFAULT 0,
  edited_at TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_for TEXT,
  reactions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_gmsg_group ON group_messages(group_id, created_at);

-- ───────────────────────── Calls ─────────────────────────
CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  caller_id TEXT NOT NULL REFERENCES users(id),
  receiver_id TEXT NOT NULL REFERENCES users(id),
  call_type TEXT NOT NULL, -- audio | video
  status TEXT NOT NULL DEFAULT 'initiated',
  offer_sdp TEXT,
  answer_sdp TEXT,
  duration INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE INDEX idx_calls_users ON calls(caller_id, receiver_id, created_at);
CREATE INDEX idx_calls_receiver ON calls(receiver_id, created_at);

-- ───────────────────────── Status / Stories ─────────────────────────
CREATE TABLE statuses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL, -- text | image | video
  content_url TEXT,
  text_content TEXT,
  background_color TEXT,
  font_style TEXT,
  thumbnail_url TEXT,
  duration INTEGER,
  caption TEXT,
  privacy TEXT NOT NULL DEFAULT 'contacts',
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_statuses_user ON statuses(user_id, created_at);
CREATE INDEX idx_statuses_expiry ON statuses(expires_at);

CREATE TABLE status_views (
  id TEXT PRIMARY KEY,
  status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES users(id),
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(status_id, viewer_id)
);

CREATE TABLE muted_statuses (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_user_id TEXT NOT NULL,
  PRIMARY KEY (user_id, muted_user_id)
);

-- ───────────────────────── Settings & notifications ─────────────────────────
CREATE TABLE privacy_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_visibility TEXT NOT NULL DEFAULT 'everyone',
  profile_photo_visibility TEXT NOT NULL DEFAULT 'everyone',
  status_visibility TEXT NOT NULL DEFAULT 'contacts',
  read_receipts INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  message_notifications INTEGER NOT NULL DEFAULT 1,
  call_notifications INTEGER NOT NULL DEFAULT 1,
  show_preview INTEGER NOT NULL DEFAULT 1,
  muted_until TEXT
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id),
  type TEXT NOT NULL,
  payload TEXT, -- JSON
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE media_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  group_message_id TEXT,
  uploader_id TEXT NOT NULL REFERENCES users(id),
  file_path TEXT NOT NULL,       -- R2 object key
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  media_type TEXT NOT NULL,      -- image | video | audio | document
  thumbnail_path TEXT,
  duration_seconds INTEGER,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
