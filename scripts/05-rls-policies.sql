-- ============================================================
-- RLS (Row Level Security) Policies
-- ============================================================
-- Run this in Supabase SQL Editor after enabling RLS on each table.
--
-- How it works:
--   - Our server signs a short-lived JWT containing { tenant_id, role: "authenticated" }
--   - API routes that serve tenant data use the anon key + that JWT
--   - Supabase reads auth.jwt() ->> 'tenant_id' in each policy
--   - Service role (used by cron, webhooks, admin) bypasses RLS entirely — no change needed there
--
-- Tables intentionally excluded (service role only):
--   tenants, users, sessions
-- ============================================================

-- ── customers ────────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── jobs ─────────────────────────────────────────────────────
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON jobs
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── leads ────────────────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leads
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── messages ─────────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── calls ────────────────────────────────────────────────────
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calls
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── cleaners ─────────────────────────────────────────────────
ALTER TABLE cleaners ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cleaners
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── cleaner_assignments ──────────────────────────────────────
ALTER TABLE cleaner_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cleaner_assignments
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── teams ────────────────────────────────────────────────────
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON teams
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── team_members ─────────────────────────────────────────────
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team_members
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── tips ─────────────────────────────────────────────────────
ALTER TABLE tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tips
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── upsells ──────────────────────────────────────────────────
ALTER TABLE upsells ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON upsells
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── reviews ──────────────────────────────────────────────────
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reviews
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── pricing_tiers ─────────────────────────────────────────────
ALTER TABLE pricing_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pricing_tiers
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── pricing_addons ────────────────────────────────────────────
ALTER TABLE pricing_addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pricing_addons
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── scheduled_tasks ───────────────────────────────────────────
-- tenant_id is nullable here (NULL = system-wide tasks run by cron via service role)
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scheduled_tasks
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── system_events ─────────────────────────────────────────────
-- tenant_id is nullable here (NULL = platform-level events, accessed via service role only)
ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON system_events
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
