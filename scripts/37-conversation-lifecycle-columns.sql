-- 37-conversation-lifecycle-columns.sql
-- Adds per-customer fields used by the 11-bug fix package (2026-04-20):
--   cold_followup_stage       — T5 cold-lead cadence state (0..3)
--   last_cold_followup_at     — timestamp of last cold-followup nudge sent
--   human_takeover_until      — when a human operator is actively owning the
--                                thread and crons/auto-response should back off
--                                until this time has passed (W3)
--
-- All columns are additive + nullable/defaulted. Safe to re-run (IF NOT EXISTS).
-- RLS policies on customers already enforce tenant isolation, so nothing new
-- needed on the policy side.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cold_followup_stage SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_cold_followup_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_takeover_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_human_operator_message_at TIMESTAMPTZ;

-- Stage must stay within 0..3 (templates are stage 1, 2, 3 — 0 means never sent).
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_cold_followup_stage_range;
ALTER TABLE customers
  ADD CONSTRAINT customers_cold_followup_stage_range
  CHECK (cold_followup_stage >= 0 AND cold_followup_stage <= 3);

-- Indexes for the cold-followup cron selection query
CREATE INDEX IF NOT EXISTS idx_customers_cold_followup_eligible
  ON customers (tenant_id, cold_followup_stage, last_cold_followup_at)
  WHERE sms_opt_out IS NOT TRUE AND auto_response_disabled IS NOT TRUE;

-- Index for active human takeover checks (partial — small, fast)
CREATE INDEX IF NOT EXISTS idx_customers_takeover_active
  ON customers (tenant_id, human_takeover_until)
  WHERE human_takeover_until IS NOT NULL;

COMMENT ON COLUMN customers.cold_followup_stage IS
  'T5 cadence state: 0=initial outbound sent (or never), 1/2/3=nudge sent at +4h/+1d/+3d. See /api/cron/cold-followup.';
COMMENT ON COLUMN customers.human_takeover_until IS
  'W3: if NOT NULL and > now(), a human operator is actively in the thread. All outreach crons must skip this customer. See canSendOutreach() helper.';
