-- Migration 31: Add staleness guard to satisfaction check RPC
--
-- Problem: unified-daily auto-completes old jobs with completed_at = NOW(),
-- which tricks the satisfaction cron into sending "How was your cleaning today?"
-- for jobs that happened weeks or months ago.
--
-- Fix: Only claim jobs whose actual date (j.date) is within the last 3 days.

CREATE OR REPLACE FUNCTION public.claim_jobs_for_satisfaction_check(p_tenant_id uuid, p_batch_size integer DEFAULT 20)
 RETURNS TABLE(job_id integer, customer_id integer, job_phone_number text, team_id integer, completed_at timestamp with time zone, paid boolean, stripe_payment_intent_id text, customer_first_name text, customer_last_name text, customer_phone text, job_type text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT j.id
    FROM jobs j
    WHERE j.tenant_id = p_tenant_id
      AND j.status = 'completed'
      AND j.satisfaction_sent_at IS NULL
      AND j.followup_sent_at IS NULL
      AND j.completed_at IS NOT NULL
      AND j.completed_at < NOW() - INTERVAL '1 minute'
      AND j.completed_at > NOW() - INTERVAL '48 hours'
      AND COALESCE(j.job_type, 'cleaning') != 'estimate'
      -- Safety: only send satisfaction checks for jobs that actually happened recently
      AND (j.date IS NULL OR j.date::date >= (CURRENT_DATE - INTERVAL '3 days'))
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
$function$;
