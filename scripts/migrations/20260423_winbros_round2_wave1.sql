-- ═══════════════════════════════════════════════════════════════════════════
-- WinBros Round 2 — Wave 1 Migrations (2026-04-23)
-- Apply in Supabase SQL Editor for project kcmbwstjmdrjkhxhkkjt.
-- These are ADDITIVE ONLY — no data changes, no breaking schema shifts.
--
-- Contents:
--   1. quote_line_items.is_upsell BOOLEAN (Q1=C upsell attribution)
--   2. tech_upsell_catalog TABLE (ring-fenced upsell picker source)
--   3. Seed 8 WinBros starter catalog rows (Max can edit post-deploy)
--
-- DOES NOT INCLUDE (waiting on Dominic/Max review of audit CSV):
--   - pay_rates.pay_mode column
--   - pay_mode backfill UPDATE
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. quote_line_items.is_upsell ──────────────────────────────────────────
ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS is_upsell BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_quote_line_items_upsell
  ON quote_line_items(quote_id, is_upsell) WHERE is_upsell = TRUE;

-- ── 2. tech_upsell_catalog TABLE ───────────────────────────────────────────
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

DROP POLICY IF EXISTS tenant_isolation ON tech_upsell_catalog;
CREATE POLICY tenant_isolation ON tech_upsell_catalog
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_tech_upsell_catalog_tenant_active
  ON tech_upsell_catalog(tenant_id, is_active, sort_order);

-- ── 3. Seed WinBros starter catalog (8 placeholders — Max can edit) ────────
-- tenant_id = e954fbd6-b3e1-4271-88b0-341c9df56beb (winbros)
INSERT INTO tech_upsell_catalog (tenant_id, name, description, price, sort_order) VALUES
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Screen rewash',      'Quick rewash of a single screen onsite',             15.00, 10),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Extra window pane',  'Additional pane not in original quote',              8.00,  20),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Gutter spot-clean',  'Clear one section of gutter (debris visible)',      40.00, 30),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Track detail',       'Deep clean of window tracks beyond standard',       25.00, 40),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Sill wipe',          'Wipe down exterior window sills',                   20.00, 50),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Skylight clean',     'Clean one skylight',                                35.00, 60),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Solar panel rinse',  'Quick rinse of accessible solar panels',            45.00, 70),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Hard-water spot Tx', 'Chemical treatment for mineral deposits',           60.00, 80)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION (run after apply):
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name='quote_line_items' AND column_name='is_upsell';
--   SELECT count(*) FROM tech_upsell_catalog
--     WHERE tenant_id='e954fbd6-b3e1-4271-88b0-341c9df56beb';
--   -- Expect: 1 row for column, 8 rows for catalog.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- DOWN (rollback if needed):
--   DELETE FROM tech_upsell_catalog WHERE tenant_id='e954fbd6-b3e1-4271-88b0-341c9df56beb';
--   DROP INDEX IF EXISTS idx_tech_upsell_catalog_tenant_active;
--   DROP POLICY IF EXISTS tenant_isolation ON tech_upsell_catalog;
--   DROP TABLE IF EXISTS tech_upsell_catalog;
--   DROP INDEX IF EXISTS idx_quote_line_items_upsell;
--   ALTER TABLE quote_line_items DROP COLUMN IF EXISTS is_upsell;
-- ═══════════════════════════════════════════════════════════════════════════
