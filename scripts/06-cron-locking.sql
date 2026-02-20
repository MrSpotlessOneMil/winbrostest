-- ============================================================================
-- CRON RACE CONDITION FIX: Atomic job claiming with FOR UPDATE SKIP LOCKED
-- ============================================================================
--
-- Problem: When two cron instances fire simultaneously, both SELECT the same
-- rows and both send SMS → duplicate messages to customers.
--
-- Fix: Each RPC function atomically claims eligible jobs by:
--   1. SELECT ... FOR UPDATE SKIP LOCKED  (locks rows, skips already-locked ones)
--   2. UPDATE the sent_at timestamp        (marks them as claimed)
--   3. RETURNING the claimed jobs          (so the cron can process them)
--
-- If Instance A locks a row, Instance B's SKIP LOCKED will skip it entirely.
-- ============================================================================


-- ─── 1. POST-JOB FOLLOWUP ──────────────────────────────────────────────────
-- Claims completed jobs needing follow-up SMS (2+ hours after completion)
CREATE OR REPLACE FUNCTION claim_jobs_for_followup(
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
  customer_phone TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT j.id
    FROM jobs j
    WHERE j.tenant_id = p_tenant_id
      AND j.status = 'completed'
      AND j.followup_sent_at IS NULL
      AND j.completed_at IS NOT NULL
      AND j.completed_at < NOW() - INTERVAL '2 hours'
    ORDER BY j.completed_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_batch_size
  ),
  updated AS (
    UPDATE jobs
    SET followup_sent_at = NOW()
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
    c.phone_number
  FROM updated u
  LEFT JOIN customers c ON c.id = u.customer_id;
END;
$$ LANGUAGE plpgsql;


-- ─── 2. MONTHLY FOLLOWUP ───────────────────────────────────────────────────
-- Claims completed jobs for 30-day re-engagement (no tenant filter — processes all)
CREATE OR REPLACE FUNCTION claim_jobs_for_monthly_followup(
  p_batch_size INT DEFAULT 100
)
RETURNS TABLE (
  job_id INT,
  customer_id INT,
  job_phone_number TEXT,
  completed_at TIMESTAMPTZ,
  customer_first_name TEXT,
  customer_phone TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT j.id
    FROM jobs j
    WHERE j.status = 'completed'
      AND j.monthly_followup_sent_at IS NULL
      AND j.completed_at IS NOT NULL
      AND j.completed_at < NOW() - INTERVAL '30 days'
    ORDER BY j.completed_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_batch_size
  ),
  updated AS (
    UPDATE jobs
    SET monthly_followup_sent_at = NOW()
    FROM claimed
    WHERE jobs.id = claimed.id
    RETURNING jobs.*
  )
  SELECT
    u.id,
    u.customer_id,
    u.phone_number,
    u.completed_at,
    c.first_name,
    c.phone_number
  FROM updated u
  LEFT JOIN customers c ON c.id = u.customer_id;
END;
$$ LANGUAGE plpgsql;


-- ─── 3. MONTHLY REENGAGEMENT ────────────────────────────────────────────────
-- Claims completed jobs in a date window for re-engagement offer
CREATE OR REPLACE FUNCTION claim_jobs_for_monthly_reengagement(
  p_tenant_id UUID,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ,
  p_batch_size INT DEFAULT 30
)
RETURNS TABLE (
  job_id INT,
  customer_id INT,
  job_phone_number TEXT,
  completed_at TIMESTAMPTZ,
  customer_first_name TEXT,
  customer_last_name TEXT,
  customer_phone TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT j.id
    FROM jobs j
    WHERE j.tenant_id = p_tenant_id
      AND j.status = 'completed'
      AND j.monthly_followup_sent_at IS NULL
      AND j.completed_at IS NOT NULL
      AND j.completed_at >= p_window_start
      AND j.completed_at <= p_window_end
    ORDER BY j.completed_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_batch_size
  ),
  updated AS (
    UPDATE jobs
    SET monthly_followup_sent_at = NOW()
    FROM claimed
    WHERE jobs.id = claimed.id
    RETURNING jobs.*
  )
  SELECT
    u.id,
    u.customer_id,
    u.phone_number,
    u.completed_at,
    c.first_name,
    c.last_name,
    c.phone_number
  FROM updated u
  LEFT JOIN customers c ON c.id = u.customer_id;
END;
$$ LANGUAGE plpgsql;


-- ─── 4. FREQUENCY NUDGE ────────────────────────────────────────────────────
-- Claims completed jobs in a nudge window for service frequency reminders
CREATE OR REPLACE FUNCTION claim_jobs_for_frequency_nudge(
  p_tenant_id UUID,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ,
  p_batch_size INT DEFAULT 30
)
RETURNS TABLE (
  job_id INT,
  customer_id INT,
  job_phone_number TEXT,
  completed_at TIMESTAMPTZ,
  customer_first_name TEXT,
  customer_phone TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT j.id
    FROM jobs j
    WHERE j.tenant_id = p_tenant_id
      AND j.status = 'completed'
      AND j.frequency_nudge_sent_at IS NULL
      AND j.monthly_followup_sent_at IS NULL
      AND j.completed_at IS NOT NULL
      AND j.completed_at >= p_window_start
      AND j.completed_at <= p_window_end
    ORDER BY j.completed_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_batch_size
  ),
  updated AS (
    UPDATE jobs
    SET frequency_nudge_sent_at = NOW()
    FROM claimed
    WHERE jobs.id = claimed.id
    RETURNING jobs.*
  )
  SELECT
    u.id,
    u.customer_id,
    u.phone_number,
    u.completed_at,
    c.first_name,
    c.phone_number
  FROM updated u
  LEFT JOIN customers c ON c.id = u.customer_id;
END;
$$ LANGUAGE plpgsql;