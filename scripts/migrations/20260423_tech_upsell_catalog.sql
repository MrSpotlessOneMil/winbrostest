-- WinBros Round 2 — tech upsell catalog (Q1=C)
-- Ring-fenced list of upsell items a tech can add to a visit on-site.
-- No free-form entry. Catalog admin-managed per-tenant.

-- UP
CREATE TABLE IF NOT EXISTS tech_upsell_catalog (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tech_upsell_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tech_upsell_catalog
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_tech_upsell_catalog_tenant_active
  ON tech_upsell_catalog(tenant_id, is_active, sort_order);

-- DOWN
-- DROP INDEX IF EXISTS idx_tech_upsell_catalog_tenant_active;
-- DROP POLICY IF EXISTS tenant_isolation ON tech_upsell_catalog;
-- DROP TABLE IF EXISTS tech_upsell_catalog;
