-- Crew Days + Time Off tables for WinBros crew management
-- Already applied to Supabase on 2026-03-31

CREATE TABLE IF NOT EXISTS crew_days (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  team_lead_id INTEGER REFERENCES cleaners(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, date, team_lead_id)
);

CREATE TABLE IF NOT EXISTS crew_day_members (
  id SERIAL PRIMARY KEY,
  crew_day_id INTEGER NOT NULL REFERENCES crew_days(id) ON DELETE CASCADE,
  cleaner_id INTEGER NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('technician', 'salesman', 'team_lead')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(crew_day_id, cleaner_id)
);

CREATE TABLE IF NOT EXISTS time_off (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cleaner_id INTEGER NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, cleaner_id, date)
);

ALTER TABLE crew_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_day_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crew_days USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
CREATE POLICY tenant_isolation ON time_off USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_crew_days_tenant_date ON crew_days(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_time_off_tenant_date ON time_off(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_time_off_cleaner ON time_off(cleaner_id, date);
