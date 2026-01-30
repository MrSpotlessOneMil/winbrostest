-- ============================================================================
-- SCHEDULED TASKS TABLE
-- ============================================================================
-- Replaces QStash for delayed/scheduled task execution.
-- Tasks are stored in the database and processed by a cron job.
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- Task identification
  task_type TEXT NOT NULL,                         -- 'lead_followup', 'job_reminder', etc.
  task_key TEXT,                                   -- Deduplication key (e.g., 'lead-123-stage-1')

  -- Execution timing
  scheduled_for TIMESTAMPTZ NOT NULL,              -- When to execute

  -- Task payload
  payload JSONB NOT NULL DEFAULT '{}',             -- Task-specific data

  -- Execution tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,

  -- Ensure unique task_key for deduplication
  UNIQUE(task_key)
);

-- Indexes for efficient querying
CREATE INDEX idx_scheduled_tasks_due ON scheduled_tasks(scheduled_for, status)
  WHERE status = 'pending';
CREATE INDEX idx_scheduled_tasks_tenant ON scheduled_tasks(tenant_id);
CREATE INDEX idx_scheduled_tasks_type ON scheduled_tasks(task_type, status);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_scheduled_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scheduled_tasks_updated
  BEFORE UPDATE ON scheduled_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduled_tasks_timestamp();

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE scheduled_tasks IS 'Stores tasks to be executed at a future time, replacing QStash';
COMMENT ON COLUMN scheduled_tasks.task_type IS 'Type of task: lead_followup, job_reminder, day_before_reminder, etc.';
COMMENT ON COLUMN scheduled_tasks.task_key IS 'Unique key for deduplication - prevents duplicate scheduling';
COMMENT ON COLUMN scheduled_tasks.scheduled_for IS 'When the task should be executed';
COMMENT ON COLUMN scheduled_tasks.payload IS 'JSON payload containing all data needed to execute the task';
