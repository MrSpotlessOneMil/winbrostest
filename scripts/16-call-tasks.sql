-- ============================================================
-- Call Tasks — manual VA call checklist for retargeting sequences
-- ============================================================

CREATE TABLE call_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  customer_name TEXT,
  customer_id INTEGER REFERENCES customers(id),
  lead_id TEXT,
  source TEXT NOT NULL,                -- 'lead_followup' | 'quoted_not_booked'
  source_context JSONB DEFAULT '{}',   -- stage/step info, sequence name, etc.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  scheduled_for DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE call_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON call_tasks
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Index for dashboard query: today's pending tasks per tenant
CREATE INDEX idx_call_tasks_tenant_date ON call_tasks (tenant_id, scheduled_for, status);
