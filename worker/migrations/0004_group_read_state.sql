-- Per-member "read up to" high-water-mark for each group. Powers two
-- things group chat has never had:
--   1. WhatsApp-style double-check ticks on a group message, once every
--      *other* member's last_read_at has caught up to it.
--   2. Accurate unread-message badges in the Groups list (previously
--      always undefined — the field existed on the type but nothing ever
--      set it).
--
-- One row per (group, member), upserted every time that member views the
-- group chat — the same high-water-mark approach every group-chat product
-- uses instead of a row per message per reader, which wouldn't scale.
--
-- Run once against each database you already created from 0001_init.sql:
--   cd worker
--   npx wrangler d1 execute nchat-db --local --file=./migrations/0004_group_read_state.sql
--   npx wrangler d1 execute nchat-db --remote --file=./migrations/0004_group_read_state.sql
-- (check --local first, then run --remote against production)

CREATE TABLE group_read_state (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_grs_group ON group_read_state(group_id);
CREATE INDEX idx_grs_user ON group_read_state(user_id);
