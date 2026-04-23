-- 42-voice-profile-customer-memory.sql
-- Adds the Humanity Engine storage.
-- Part of OUTREACH-SPEC v1.0 Section 8.

-- Tenant-level voice profile (owner's texting style)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS voice_profile JSONB DEFAULT '{}'::jsonb;

-- Per-customer personality memory — built from chat history.
CREATE TABLE IF NOT EXISTS customer_memory (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL,
  personality JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_memory_tenant_customer
  ON customer_memory (tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_memory_refreshed
  ON customer_memory (last_refreshed_at);

ALTER TABLE customer_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customer_memory;
CREATE POLICY tenant_isolation ON customer_memory
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
