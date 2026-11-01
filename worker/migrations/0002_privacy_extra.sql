-- Adds the two privacy toggles the frontend already has UI for (About
-- visibility, and a dedicated Online Status switch) but which 0001_init.sql
-- didn't yet have columns for.
--
-- Run once against each database you already created from 0001_init.sql:
--   cd worker
--   npx wrangler d1 execute nchat-db --remote --file=./migrations/0002_privacy_extra.sql
-- (use --local instead of --remote to also update your local dev DB)

ALTER TABLE privacy_settings ADD COLUMN about_visibility TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE privacy_settings ADD COLUMN online_status_enabled INTEGER NOT NULL DEFAULT 1;
