-- 39-conversation-state.sql
-- Denormalized per-(tenant, phone) conversation state. Every outbound SMS must
-- read this row before sending — single source of truth for booking status,
-- last interaction times, cold-cadence stage, human takeover, timezone, and
-- known facts collected from form submissions.
--
-- Cross-cutting 11-bug fix (2026-04-20). Maintained by triggers on jobs,
-- customers, and messages so callers never need to recompute state.

CREATE TABLE IF NOT EXISTS conversation_state (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id                      BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  phone                            TEXT NOT NULL,

  -- Lifecycle
  booking_status                   TEXT NOT NULL DEFAULT 'none'
                                     CHECK (booking_status IN (
                                       'none','quoted','booking_pending',
                                       'confirmed','completed','canceled','lost'
                                     )),
  active_job_id                    BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
  appointment_at                   TIMESTAMPTZ,

  -- Human takeover
  human_takeover_until             TIMESTAMPTZ,
  last_human_operator_message_at   TIMESTAMPTZ,

  -- Intake
  known_facts                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_fields                  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Scheduling
  timezone                         TEXT NOT NULL DEFAULT 'America/Chicago',

  -- Cadence counters
  last_agent_message_at            TIMESTAMPTZ,
  last_customer_message_at         TIMESTAMPTZ,
  agent_message_count_since_booking INT NOT NULL DEFAULT 0,
  cold_followup_stage              SMALLINT NOT NULL DEFAULT 0,

  -- Escalation
  escalated                        BOOLEAN NOT NULL DEFAULT false,
  escalated_reason                 TEXT,
  escalated_at                     TIMESTAMPTZ,

  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_cs_phone
  ON conversation_state (tenant_id, phone);

CREATE INDEX IF NOT EXISTS idx_cs_takeover_active
  ON conversation_state (human_takeover_until)
  WHERE human_takeover_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cs_cold_cadence
  ON conversation_state (last_agent_message_at, cold_followup_stage)
  WHERE booking_status = 'none';

CREATE INDEX IF NOT EXISTS idx_cs_booking_status
  ON conversation_state (tenant_id, booking_status);

-- RLS: service role only (same pattern as sms_outreach_queue)
ALTER TABLE conversation_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_state_service_all ON conversation_state;
CREATE POLICY conversation_state_service_all ON conversation_state
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Tenant-scoped read (dashboard) via HS256 JWT — customers can never read
CREATE POLICY conversation_state_tenant_read ON conversation_state
  FOR SELECT
  USING (
    tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id'
  );

-- ── Maintenance trigger: refresh booking fields from jobs ────────────────
CREATE OR REPLACE FUNCTION sync_conversation_state_from_job() RETURNS TRIGGER AS $$
DECLARE
  v_customer_phone TEXT;
  v_new_status TEXT;
  v_appointment_at TIMESTAMPTZ;
BEGIN
  -- Determine booking_status mapping
  v_new_status := CASE NEW.status
    WHEN 'quoted' THEN 'quoted'
    WHEN 'scheduled' THEN 'confirmed'
    WHEN 'in_progress' THEN 'confirmed'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'canceled'
    WHEN 'canceled' THEN 'canceled'
    ELSE 'none'
  END;

  -- Look up the customer phone (stored on jobs or customers)
  v_customer_phone := COALESCE(NEW.phone_number, NEW.customer_phone);
  IF v_customer_phone IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT phone_number INTO v_customer_phone
    FROM customers
    WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id;
  END IF;

  IF v_customer_phone IS NULL THEN
    RETURN NEW;
  END IF;

  -- Combine jobs.date (DATE) + jobs.scheduled_at (TEXT time like "10:00") into a TIMESTAMPTZ.
  -- scheduled_at is TEXT, so cast via date + time concatenation.
  IF NEW.date IS NOT NULL AND NEW.scheduled_at IS NOT NULL AND NEW.scheduled_at <> '' THEN
    v_appointment_at := (NEW.date::date || ' ' || NEW.scheduled_at)::timestamptz;
  ELSIF NEW.date IS NOT NULL THEN
    v_appointment_at := NEW.date::date::timestamptz;
  ELSE
    v_appointment_at := NULL;
  END IF;

  -- Upsert — if the new row represents the most recent active job, adopt it.
  INSERT INTO conversation_state (
    tenant_id, customer_id, phone,
    booking_status, active_job_id, appointment_at, updated_at
  ) VALUES (
    NEW.tenant_id, NEW.customer_id, v_customer_phone,
    v_new_status, NEW.id, v_appointment_at, now()
  )
  ON CONFLICT (tenant_id, phone) DO UPDATE SET
    booking_status = CASE
      -- Confirmed bookings dominate over quoted/none
      WHEN EXCLUDED.booking_status IN ('confirmed','completed') THEN EXCLUDED.booking_status
      WHEN conversation_state.booking_status IN ('confirmed','completed') AND EXCLUDED.booking_status = 'none' THEN conversation_state.booking_status
      ELSE EXCLUDED.booking_status
    END,
    active_job_id = CASE
      WHEN EXCLUDED.booking_status IN ('confirmed','in_progress') THEN EXCLUDED.active_job_id
      ELSE conversation_state.active_job_id
    END,
    appointment_at = COALESCE(EXCLUDED.appointment_at, conversation_state.appointment_at),
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_jobs_sync_conversation_state ON jobs;
CREATE TRIGGER trg_jobs_sync_conversation_state
  AFTER INSERT OR UPDATE OF status, scheduled_at ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION sync_conversation_state_from_job();

-- ── Maintenance trigger: refresh on message activity ─────────────────────
CREATE OR REPLACE FUNCTION sync_conversation_state_from_message() RETURNS TRIGGER AS $$
DECLARE
  v_is_agent BOOLEAN;
BEGIN
  IF NEW.phone_number IS NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Agent-origin = pre-inserted by our system (any source except dashboard/openphone_app)
  v_is_agent := NEW.direction = 'outbound' AND NEW.source NOT IN ('dashboard','openphone_app');

  INSERT INTO conversation_state (tenant_id, customer_id, phone, updated_at)
  VALUES (NEW.tenant_id, NEW.customer_id, NEW.phone_number, now())
  ON CONFLICT (tenant_id, phone) DO UPDATE SET
    last_agent_message_at    = CASE WHEN NEW.direction='outbound' AND v_is_agent THEN NEW.created_at ELSE conversation_state.last_agent_message_at END,
    last_customer_message_at = CASE WHEN NEW.direction='inbound' THEN NEW.created_at ELSE conversation_state.last_customer_message_at END,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_messages_sync_conversation_state ON messages;
CREATE TRIGGER trg_messages_sync_conversation_state
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION sync_conversation_state_from_message();

-- ── Maintenance trigger: mirror customers.human_takeover_until ───────────
CREATE OR REPLACE FUNCTION sync_conversation_state_from_customer() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone_number IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO conversation_state (
    tenant_id, customer_id, phone,
    human_takeover_until, last_human_operator_message_at,
    cold_followup_stage, timezone, updated_at
  ) VALUES (
    NEW.tenant_id, NEW.id, NEW.phone_number,
    NEW.human_takeover_until, NEW.last_human_operator_message_at,
    COALESCE(NEW.cold_followup_stage, 0),
    'America/Chicago',
    now()
  )
  ON CONFLICT (tenant_id, phone) DO UPDATE SET
    customer_id                    = EXCLUDED.customer_id,
    human_takeover_until           = EXCLUDED.human_takeover_until,
    last_human_operator_message_at = EXCLUDED.last_human_operator_message_at,
    cold_followup_stage            = COALESCE(EXCLUDED.cold_followup_stage, conversation_state.cold_followup_stage),
    updated_at                     = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_customers_sync_conversation_state ON customers;
CREATE TRIGGER trg_customers_sync_conversation_state
  AFTER INSERT OR UPDATE OF human_takeover_until, last_human_operator_message_at, cold_followup_stage, phone_number ON customers
  FOR EACH ROW
  EXECUTE FUNCTION sync_conversation_state_from_customer();

COMMENT ON TABLE conversation_state IS
  'Denormalized per-(tenant, phone) state. Read before every outbound SMS. Maintained by triggers on jobs, messages, customers.';
