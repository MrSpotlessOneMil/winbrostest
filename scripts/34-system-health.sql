-- System Health Monitoring Table
-- Stores periodic health check results for the Osiris ecosystem
-- Used by GET /api/cron/system-health (runs every 6 hours)

CREATE TABLE IF NOT EXISTS system_health (
  id SERIAL PRIMARY KEY,
  check_name TEXT NOT NULL,
  component TEXT NOT NULL, -- 'sam_scraper', 'sam_outreach', 'sam_enrichment', 'osiris_responder', 'osiris_scoring', 'osiris_brain', 'osiris_pricing', 'osiris_jobs'
  status TEXT NOT NULL, -- 'healthy', 'warning', 'critical', 'unknown'
  details JSONB DEFAULT '{}',
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_health_component ON system_health(component, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_health_checked_at ON system_health(checked_at DESC);
