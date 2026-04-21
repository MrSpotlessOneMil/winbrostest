-- Migration: Disable ALL retargeting, auto-enroll, and re-engagement for every customer
-- Date: 2026-04-21
-- Reason: Old customers being mass-contacted. Kill all outbound automation immediately.

BEGIN;

-- 1. Cancel all pending retargeting & reengagement scheduled tasks
UPDATE scheduled_tasks
SET status = 'cancelled',
    updated_at = NOW()
WHERE status = 'pending'
  AND task_type IN (
    'retargeting',
    'lead_followup',
    'post_job_review',
    'post_job_recurring_push',
    'monthly_reengagement',
    'hot_lead_followup',
    'quote_followup_urgent'
  );

-- 2. Clear retargeting state on ALL customers
UPDATE customers
SET retargeting_sequence = NULL,
    retargeting_step = NULL,
    retargeting_enrolled_at = NULL,
    retargeting_stopped_reason = 'admin_disabled',
    retargeting_variant = NULL
WHERE retargeting_sequence IS NOT NULL
   OR retargeting_step IS NOT NULL
   OR retargeting_enrolled_at IS NOT NULL;

-- 3. Disable monthly_followup_enabled and seasonal_reminders_enabled on ALL tenants
UPDATE tenants
SET workflow_config = workflow_config
    || '{"monthly_followup_enabled": false, "seasonal_reminders_enabled": false}'::jsonb,
    updated_at = NOW();

COMMIT;
