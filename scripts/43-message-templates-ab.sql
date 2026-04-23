-- 43-message-templates-ab.sql
-- A/B testing infrastructure for outreach pipelines.
-- Part of OUTREACH-SPEC v1.0 Section 9.

CREATE TABLE IF NOT EXISTS message_templates (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = global template
  pipeline TEXT NOT NULL CHECK (pipeline IN ('pre_quote', 'post_quote', 'retargeting')),
  stage INT NOT NULL,
  variant CHAR(1) NOT NULL CHECK (variant IN ('a', 'b')),
  prompt_template TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  UNIQUE (tenant_id, pipeline, stage, variant, status) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_message_templates_lookup
  ON message_templates (tenant_id, pipeline, stage, variant) WHERE status = 'active';

-- Add variant tracking to messages (safe: nullable for legacy rows)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS template_id BIGINT REFERENCES message_templates(id),
  ADD COLUMN IF NOT EXISTS variant CHAR(1) CHECK (variant IN ('a', 'b'));

CREATE INDEX IF NOT EXISTS idx_messages_template
  ON messages (template_id, variant) WHERE template_id IS NOT NULL;

-- Materialized view for A/B results — refreshed nightly.
CREATE MATERIALIZED VIEW IF NOT EXISTS ab_results AS
SELECT
  mt.id AS template_id,
  mt.tenant_id,
  mt.pipeline,
  mt.stage,
  mt.variant,
  mt.status,
  COUNT(DISTINCT m.id) AS sent,
  COUNT(DISTINCT CASE
    WHEN EXISTS (
      SELECT 1 FROM messages reply
      WHERE reply.customer_id = m.customer_id
        AND reply.tenant_id = m.tenant_id
        AND reply.direction = 'inbound'
        AND reply.timestamp BETWEEN m.timestamp AND m.timestamp + INTERVAL '48 hours'
    ) THEN m.id END) AS replied,
  COUNT(DISTINCT CASE
    WHEN EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.customer_id = m.customer_id
        AND j.tenant_id = m.tenant_id
        AND j.status IN ('scheduled', 'in_progress', 'completed')
        AND j.created_at BETWEEN m.timestamp AND m.timestamp + INTERVAL '14 days'
    ) THEN m.id END) AS booked,
  COALESCE(SUM(CASE
    WHEN EXISTS (
      SELECT 1 FROM jobs j2
      WHERE j2.customer_id = m.customer_id
        AND j2.tenant_id = m.tenant_id
        AND j2.status IN ('scheduled', 'in_progress', 'completed')
        AND j2.created_at BETWEEN m.timestamp AND m.timestamp + INTERVAL '14 days'
    )
    THEN (SELECT AVG(j3.price) FROM jobs j3
          WHERE j3.customer_id = m.customer_id
            AND j3.tenant_id = m.tenant_id
            AND j3.status IN ('scheduled', 'in_progress', 'completed')
            AND j3.created_at BETWEEN m.timestamp AND m.timestamp + INTERVAL '14 days')
    ELSE 0 END), 0)::numeric(12,2) AS revenue_est,
  NOW() AS last_updated
FROM message_templates mt
LEFT JOIN messages m ON m.template_id = mt.id AND m.variant = mt.variant
GROUP BY mt.id, mt.tenant_id, mt.pipeline, mt.stage, mt.variant, mt.status;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ab_results_template
  ON ab_results (template_id);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON message_templates;
CREATE POLICY tenant_isolation ON message_templates
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id'
  );
