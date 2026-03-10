-- ============================================================================
-- LIFECYCLE AUTOMATION: Database migration
-- ============================================================================
--
-- Creates cross-cron cooldown tracking and formalizes lifecycle columns.
-- All ALTER TABLE uses IF NOT EXISTS — safe to re-run.
-- ============================================================================


-- ─── 1. CUSTOMER MESSAGE LOG (cross-cron cooldown) ──────────────────────────
-- Central log of every automated message sent to a customer.
-- Used by lifecycle engine to enforce per-phase cooldowns + daily caps.

CREATE TABLE IF NOT EXISTS customer_message_log (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  source TEXT NOT NULL,          -- e.g. 'post_job_satisfaction', 'quote_followup', 'recurring_push'
  lifecycle_phase TEXT NOT NULL, -- e.g. 'post_job', 'quote_followup', 'reengagement', 'conversation'
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cml_customer_recent ON customer_message_log(customer_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_cml_tenant ON customer_message_log(tenant_id);

-- RLS
ALTER TABLE customer_message_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'customer_message_log' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON customer_message_log
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;


-- ─── 2. CUSTOMER COLUMNS ────────────────────────────────────────────────────
-- Post-job conversation state
ALTER TABLE customers ADD COLUMN IF NOT EXISTS post_job_stage TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS post_job_stage_updated_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_automated_message_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS awaiting_reply_since TIMESTAMPTZ;

-- Formalize ghost columns (IF NOT EXISTS is safe if they already exist in prod)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS auto_response_paused BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS retargeting_sequence TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS retargeting_step INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS retargeting_enrolled_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS retargeting_completed_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS retargeting_stopped_reason TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS retargeting_variant TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS retargeting_replied_at TIMESTAMPTZ;


-- ─── 3. JOB COLUMNS ─────────────────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS satisfaction_sent_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS satisfaction_response TEXT;    -- 'positive', 'negative'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_sent_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurring_offered_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurring_response TEXT;      -- 'accepted', 'declined'


-- ─── 4. QUOTE COLUMNS ───────────────────────────────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS followup_enrolled_at TIMESTAMPTZ;
