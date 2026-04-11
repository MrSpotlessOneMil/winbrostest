-- ============================================================================
-- LIFECYCLE AUTOMATION: RPC functions
-- ============================================================================


-- ─── 1. CHECK CUSTOMER COOLDOWN ─────────────────────────────────────────────
-- Returns TRUE if safe to send (no recent message in this phase).
-- Used by lifecycle engine before every automated message.

DROP FUNCTION IF EXISTS check_customer_cooldown(INTEGER, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION check_customer_cooldown(
  p_customer_id INTEGER,
  p_lifecycle_phase TEXT,
  p_cooldown_hours INTEGER DEFAULT 24,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_recent_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_recent_count
  FROM customer_message_log
  WHERE customer_id = p_customer_id
    AND lifecycle_phase = p_lifecycle_phase
    AND sent_at > NOW() - (p_cooldown_hours || ' hours')::INTERVAL
    AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id);

  RETURN v_recent_count = 0;
END;
$$ LANGUAGE plpgsql STABLE;


-- ─── 2. CLAIM JOBS FOR SATISFACTION CHECK ────────────────────────────────────
-- Replaces claim_jobs_for_followup for the new satisfaction-first flow.
-- Targets completed jobs 2-48 hours old that haven't been satisfaction-checked.
-- Jobs already processed by old followup_sent_at are skipped.

CREATE OR REPLACE FUNCTION claim_jobs_for_satisfaction_check(
  p_tenant_id UUID,
  p_batch_size INT DEFAULT 20
)
RETURNS TABLE (
  job_id INT,
  customer_id INT,
  job_phone_number TEXT,
  team_id INT,
  completed_at TIMESTAMPTZ,
  paid BOOLEAN,
  stripe_payment_intent_id TEXT,
  customer_first_name TEXT,
  customer_last_name TEXT,
  customer_phone TEXT,
  job_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT j.id
    FROM jobs j
    WHERE j.tenant_id = p_tenant_id
      AND j.status = 'completed'
      AND j.satisfaction_sent_at IS NULL
      AND j.followup_sent_at IS NULL  -- Skip jobs already processed by old cron
      AND j.completed_at IS NOT NULL
      AND j.payment_status = 'fully_paid'  -- Only after card charged
      AND j.completed_at < NOW() - INTERVAL '2 minutes'
      AND j.completed_at > NOW() - INTERVAL '48 hours'
      AND COALESCE(j.job_type, 'cleaning') != 'estimate'
    ORDER BY j.completed_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_batch_size
  ),
  updated AS (
    UPDATE jobs
    SET satisfaction_sent_at = NOW()
    FROM claimed
    WHERE jobs.id = claimed.id
    RETURNING jobs.*
  )
  SELECT
    u.id,
    u.customer_id,
    u.phone_number,
    u.team_id,
    u.completed_at,
    u.paid,
    u.stripe_payment_intent_id,
    c.first_name,
    c.last_name,
    c.phone_number,
    u.job_type
  FROM updated u
  LEFT JOIN customers c ON c.id = u.customer_id;
END;
$$ LANGUAGE plpgsql;


-- ─── 3. REFRESH CUSTOMER LIFECYCLES ──────────────────────────────────────────
-- Computes lifecycle_stage from job history per tenant.
-- Respects lifecycle_stage_override if set.
--
-- Stages: active → repeat → one_time → lapsed → quoted_not_booked → new_lead

-- Drop first: return type changed from previous version
DROP FUNCTION IF EXISTS refresh_customer_lifecycles(UUID);

CREATE OR REPLACE FUNCTION refresh_customer_lifecycles(
  p_tenant_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  -- Active: has a job scheduled or in progress
  UPDATE customers SET lifecycle_stage = 'active'
  WHERE tenant_id = p_tenant_id
    AND lifecycle_stage_override IS NULL
    AND id IN (
      SELECT DISTINCT customer_id FROM jobs
      WHERE tenant_id = p_tenant_id
        AND status IN ('scheduled', 'in_progress')
        AND customer_id IS NOT NULL
    );
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Repeat: 2+ completed jobs, most recent within 90 days
  UPDATE customers SET lifecycle_stage = 'repeat'
  WHERE tenant_id = p_tenant_id
    AND lifecycle_stage_override IS NULL
    AND lifecycle_stage IS DISTINCT FROM 'active'
    AND id IN (
      SELECT customer_id FROM jobs
      WHERE tenant_id = p_tenant_id
        AND status = 'completed'
        AND customer_id IS NOT NULL
      GROUP BY customer_id
      HAVING COUNT(*) >= 2
        AND MAX(completed_at) > NOW() - INTERVAL '90 days'
    );

  -- One-time: exactly 1 completed job within 90 days
  UPDATE customers SET lifecycle_stage = 'one_time'
  WHERE tenant_id = p_tenant_id
    AND lifecycle_stage_override IS NULL
    AND lifecycle_stage IS DISTINCT FROM 'active'
    AND lifecycle_stage IS DISTINCT FROM 'repeat'
    AND id IN (
      SELECT customer_id FROM jobs
      WHERE tenant_id = p_tenant_id
        AND status = 'completed'
        AND customer_id IS NOT NULL
      GROUP BY customer_id
      HAVING COUNT(*) = 1
        AND MAX(completed_at) > NOW() - INTERVAL '90 days'
    );

  -- Lapsed: has completed jobs but none in last 90 days
  UPDATE customers SET lifecycle_stage = 'lapsed'
  WHERE tenant_id = p_tenant_id
    AND lifecycle_stage_override IS NULL
    AND lifecycle_stage IS DISTINCT FROM 'active'
    AND lifecycle_stage IS DISTINCT FROM 'repeat'
    AND lifecycle_stage IS DISTINCT FROM 'one_time'
    AND id IN (
      SELECT customer_id FROM jobs
      WHERE tenant_id = p_tenant_id
        AND status = 'completed'
        AND customer_id IS NOT NULL
      GROUP BY customer_id
      HAVING MAX(completed_at) <= NOW() - INTERVAL '90 days'
    );

  -- Quoted not booked: has a quote but no completed jobs
  UPDATE customers SET lifecycle_stage = 'quoted_not_booked'
  WHERE tenant_id = p_tenant_id
    AND lifecycle_stage_override IS NULL
    AND lifecycle_stage IS DISTINCT FROM 'active'
    AND lifecycle_stage IS DISTINCT FROM 'repeat'
    AND lifecycle_stage IS DISTINCT FROM 'one_time'
    AND lifecycle_stage IS DISTINCT FROM 'lapsed'
    AND id IN (
      SELECT DISTINCT customer_id FROM quotes
      WHERE tenant_id = p_tenant_id
        AND customer_id IS NOT NULL
    )
    AND id NOT IN (
      SELECT DISTINCT customer_id FROM jobs
      WHERE tenant_id = p_tenant_id
        AND status = 'completed'
        AND customer_id IS NOT NULL
    );

  -- New lead: everything else with a tenant_id
  UPDATE customers SET lifecycle_stage = 'new_lead'
  WHERE tenant_id = p_tenant_id
    AND lifecycle_stage_override IS NULL
    AND lifecycle_stage IS NULL;

  -- Apply overrides
  UPDATE customers SET lifecycle_stage = lifecycle_stage_override
  WHERE tenant_id = p_tenant_id
    AND lifecycle_stage_override IS NOT NULL
    AND lifecycle_stage IS DISTINCT FROM lifecycle_stage_override;

  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;
