-- Group voice/video calling. Unlike 1:1 calls (one `calls` row per call,
-- a single caller/receiver pair), a group call can have any number of
-- members ringing, joining and leaving independently over its lifetime,
-- so it needs its own two tables instead of reusing `calls`:
--   * group_calls: one row per call session for a group.
--   * group_call_participants: one row per (call, member) — tracks each
--     member's own ringing/joined/declined/left status, independent of
--     everyone else's.
--
-- The actual media topology is a mesh (every joined participant holds a
-- direct WebRTC connection to every other joined participant) — the
-- right scope for the existing P2P/TURN-only infra this app already has
-- for 1:1 calls (no SFU media server), same approach most group calling
-- features start with before they need one.
--
-- Run once against each database you already created from 0001_init.sql:
--   cd worker
--   npx wrangler d1 execute nchat-db --local --file=./migrations/0005_group_calls.sql
--   npx wrangler d1 execute nchat-db --remote --file=./migrations/0005_group_calls.sql
-- (check --local first, then run --remote against production)

CREATE TABLE group_calls (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  caller_id TEXT NOT NULL REFERENCES users(id),
  call_type TEXT NOT NULL, -- 'audio' | 'video'
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'ended'
  created_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX idx_gcalls_group ON group_calls(group_id, created_at);

CREATE TABLE group_call_participants (
  call_id TEXT NOT NULL REFERENCES group_calls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ringing', -- 'ringing' | 'joined' | 'declined' | 'left' | 'missed'
  joined_at TEXT,
  left_at TEXT,
  PRIMARY KEY (call_id, user_id)
);
CREATE INDEX idx_gcp_call ON group_call_participants(call_id);
CREATE INDEX idx_gcp_user ON group_call_participants(user_id);
