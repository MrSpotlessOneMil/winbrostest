-- Migration: Lifecycle Messaging Feature Flags + Tracking Columns
-- Date: 2026-02-18
-- Description: Adds seasonal reminder tracking to customers, frequency nudge tracking to jobs,
--              and lifecycle messaging feature flags to tenant workflow_config.

-- 1. Add seasonal_reminder_tracker JSONB to customers (tracks which campaigns each customer received)
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS seasonal_reminder_tracker JSONB DEFAULT '{}'::jsonb;

-- 2. Add frequency_nudge_sent_at to jobs (dedup for frequency nudge cron)
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS frequency_nudge_sent_at TIMESTAMPTZ;

-- 3. Backfill existing tenants with lifecycle messaging defaults in workflow_config
-- This sets all new flags to false/defaults so nothing activates until explicitly enabled
UPDATE tenants
SET workflow_config = workflow_config
  || '{"seasonal_reminders_enabled": false, "frequency_nudge_enabled": false, "frequency_nudge_days": 21, "review_only_followup_enabled": false, "seasonal_campaigns": []}'::jsonb
WHERE workflow_config IS NOT NULL
  AND NOT (workflow_config ? 'seasonal_reminders_enabled');

-- 4. Index for seasonal reminder cron queries (find customers who haven't received a campaign)
CREATE INDEX IF NOT EXISTS idx_customers_seasonal_tracker
ON customers USING gin (seasonal_reminder_tracker);

-- 5. Index for frequency nudge cron queries
CREATE INDEX IF NOT EXISTS idx_jobs_frequency_nudge
ON jobs (tenant_id, status, completed_at)
WHERE frequency_nudge_sent_at IS NULL AND status = 'completed';
