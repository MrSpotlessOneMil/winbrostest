-- 44-outreach-audit.sql
-- Nightly wrong-bucket audit for the new outreach pipelines.
-- Part of OUTREACH-SPEC v1.0 Section 10.6.

CREATE TABLE IF NOT EXISTS outreach_audit_reports (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  total_outbound INT NOT NULL DEFAULT 0,
  critical_findings INT NOT NULL DEFAULT 0,
  warn_findings INT NOT NULL DEFAULT 0,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_outreach_audit_run_at
  ON outreach_audit_reports (run_at DESC);

-- Individual finding rows (for dashboard drill-down)
CREATE TABLE IF NOT EXISTS outreach_audit_findings (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES outreach_audit_reports(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warn', 'info')),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id BIGINT,
  message_id BIGINT,
  reason TEXT NOT NULL,
  detail JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_audit_findings_report
  ON outreach_audit_findings (report_id, severity);

CREATE INDEX IF NOT EXISTS idx_outreach_audit_findings_customer
  ON outreach_audit_findings (tenant_id, customer_id) WHERE severity = 'critical';
