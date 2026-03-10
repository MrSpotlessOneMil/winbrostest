-- Migration 12: Add external_message_id to messages for webhook dedup
--
-- Problem: OpenPhone sends duplicate webhooks within milliseconds.
-- The SELECT-then-INSERT dedup check races — both find nothing, both insert.
-- Fix: unique partial index on external_message_id so the DB enforces uniqueness.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_message_id
  ON messages(external_message_id) WHERE external_message_id IS NOT NULL;

-- Backfill existing messages that have openphone_message_id in metadata
UPDATE messages
SET external_message_id = metadata->>'openphone_message_id'
WHERE external_message_id IS NULL
  AND metadata->>'openphone_message_id' IS NOT NULL
  AND metadata->>'openphone_message_id' != '';
