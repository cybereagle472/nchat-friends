-- Adds the `duration` column to group_messages so group voice messages can
-- store their recorded length, matching the 1:1 `messages` table which
-- already has this column (see 0001_init.sql). Without this, group voice
-- messages have nowhere to persist their duration server-side.
--
-- Run once against each database you already created from 0001_init.sql:
--   cd worker
--   npx wrangler d1 execute nchat-db --local --file=./migrations/0003_group_voice_duration.sql
--   npx wrangler d1 execute nchat-db --remote --file=./migrations/0003_group_voice_duration.sql
-- (check --local first, then run --remote against production)

ALTER TABLE group_messages ADD COLUMN duration TEXT;
