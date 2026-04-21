-- 38-sms-outreach-queue.sql
-- Queue table for deferred SMS outreach (T6 — 2026-04-20).
--
-- When a cron or caller tries to send an 'outreach' SMS outside the tenant's
-- quiet-hours window (9pm–9am local), it enqueues here instead of sending
-- immediately. /api/cron/drain-sms-queue picks up rows whose scheduled_for_at
-- is due + inside business hours, and dispatches them.
--
-- Transactional replies (kind='transactional') never go through this queue —
-- they're replies to live inbound customer messages and always send.

CREATE TABLE IF NOT EXISTS sms_outreach_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  phone         TEXT NOT NULL,
  body          TEXT NOT NULL,
  source        TEXT NOT NULL,
  scheduled_for_at TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','canceled')),
  attempts      SMALLINT NOT NULL DEFAULT 0,
  last_error    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_queue_due
  ON sms_outreach_queue (scheduled_for_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sms_queue_tenant_status
  ON sms_outreach_queue (tenant_id, status);

-- RLS: writable only by service role (no tenant-scoped writes). Reads for
-- dashboard audit go through service role only.
ALTER TABLE sms_outreach_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_outreach_queue_service_all ON sms_outreach_queue;
CREATE POLICY sms_outreach_queue_service_all ON sms_outreach_queue
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE sms_outreach_queue IS
  'T6: deferred outreach SMS queued outside quiet hours. Drained by /api/cron/drain-sms-queue.';
