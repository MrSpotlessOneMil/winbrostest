-- 41-lifecycle-state-railway.sql
-- Adds the customer lifecycle state machine (aka "the railway").
-- Part of OUTREACH-SPEC v1.0 (frozen 2026-04-22).
--
-- Idempotent. Safe to re-run.

-- Enum of allowed states. Keep in sync with lib/lifecycle-state.ts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lifecycle_state_t') THEN
    CREATE TYPE lifecycle_state_t AS ENUM (
      'new_lead',
      'engaged',
      'quoted',
      'approved',
      'scheduled',
      'in_service',
      'awaiting_payment',
      'paid',
      'recurring',
      'retargeting',
      'archived'
    );
  END IF;
END$$;

-- Column lives on customers. Default new_lead for safety.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS lifecycle_state lifecycle_state_t;

-- Backfill existing customers based on observable state. This is a best-effort
-- seed so the new pipelines have something to read; the state machine will
-- self-correct on next transition event.
UPDATE customers c
SET lifecycle_state = CASE
  -- archived: hard disabled
  WHEN c.sms_opt_out = TRUE THEN 'archived'::lifecycle_state_t
  WHEN c.retargeting_stopped_reason = 'admin_disabled' THEN 'archived'::lifecycle_state_t

  -- recurring: active membership
  WHEN EXISTS (
    SELECT 1 FROM customer_memberships m
    WHERE m.customer_id = c.id
      AND m.tenant_id = c.tenant_id
      AND m.status IN ('active', 'paused')
  ) THEN 'recurring'::lifecycle_state_t

  -- scheduled / in_service / awaiting_payment / paid: most recent job status
  WHEN EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.customer_id = c.id AND j.tenant_id = c.tenant_id
      AND j.status = 'in_progress'
  ) THEN 'in_service'::lifecycle_state_t
  WHEN EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.customer_id = c.id AND j.tenant_id = c.tenant_id
      AND j.status = 'scheduled'
  ) THEN 'scheduled'::lifecycle_state_t
  WHEN EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.customer_id = c.id AND j.tenant_id = c.tenant_id
      AND j.status = 'completed' AND COALESCE(j.paid, FALSE) = FALSE
  ) THEN 'awaiting_payment'::lifecycle_state_t
  WHEN EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.customer_id = c.id AND j.tenant_id = c.tenant_id
      AND j.status = 'completed' AND COALESCE(j.paid, FALSE) = TRUE
      AND j.completed_at >= NOW() - INTERVAL '30 days'
  ) THEN 'paid'::lifecycle_state_t

  -- retargeting: had a paid job more than 30 days ago, no active job
  WHEN EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.customer_id = c.id AND j.tenant_id = c.tenant_id
      AND j.status = 'completed'
  ) AND NOT EXISTS (
    SELECT 1 FROM jobs j2
    WHERE j2.customer_id = c.id AND j2.tenant_id = c.tenant_id
      AND j2.status IN ('pending', 'quoted', 'scheduled', 'in_progress')
  ) THEN 'retargeting'::lifecycle_state_t

  -- quoted: active quote row
  WHEN EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.customer_id = c.id AND j.tenant_id = c.tenant_id
      AND j.status = 'quoted'
  ) THEN 'quoted'::lifecycle_state_t

  -- engaged: had an inbound reply
  WHEN EXISTS (
    SELECT 1 FROM messages m
    WHERE m.customer_id = c.id AND m.tenant_id = c.tenant_id
      AND m.direction = 'inbound'
  ) THEN 'engaged'::lifecycle_state_t

  -- default: fresh lead
  ELSE 'new_lead'::lifecycle_state_t
END
WHERE c.lifecycle_state IS NULL;

ALTER TABLE customers
  ALTER COLUMN lifecycle_state SET DEFAULT 'new_lead',
  ALTER COLUMN lifecycle_state SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_lifecycle_state
  ON customers (tenant_id, lifecycle_state);

-- Transition log — every state change written here. Source of truth for audits.
CREATE TABLE IF NOT EXISTS customer_state_transitions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL,
  from_state lifecycle_state_t,
  to_state lifecycle_state_t NOT NULL,
  event TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_transitions_customer
  ON customer_state_transitions (tenant_id, customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_state_transitions_created
  ON customer_state_transitions (created_at DESC);

-- RLS — tenant_isolation pattern (mirrors scripts/05-rls-policies.sql)
ALTER TABLE customer_state_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON customer_state_transitions;
CREATE POLICY tenant_isolation ON customer_state_transitions
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
