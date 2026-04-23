-- WinBros Round 2 — add is_upsell flag to quote line items
-- Part of Q1=C (pre-approved tech upsell catalog) implementation.
-- Replaces timer-based upsell gating: commission routes by quote-line is_upsell, not by visit timer.

-- UP
ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS is_upsell BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_quote_line_items_upsell
  ON quote_line_items(quote_id, is_upsell) WHERE is_upsell = TRUE;

-- DOWN
-- DROP INDEX IF EXISTS idx_quote_line_items_upsell;
-- ALTER TABLE quote_line_items DROP COLUMN IF EXISTS is_upsell;
