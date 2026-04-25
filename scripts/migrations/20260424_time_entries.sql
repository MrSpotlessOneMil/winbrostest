-- Wave 3h — clock-in/out for hourly-pay technicians + team leads.
--
-- Why: Blake wants "click to clock in, click to pause, click to clock out"
-- with drive time between jobs counted as paid. Today, payroll's hourly
-- path pulls hours from visits.started_at/stopped_at — that's on-job-only,
-- excluding drive. After this migration, hourly workers' weekly hours come
-- from SUM(clock_out_at - clock_in_at - paused_minutes) of their
-- time_entries rows.
--
-- pay_rates.pay_mode is already in place; every WinBros tech is currently
-- 'hourly' at $25/hr. No additional pay-mode column needed.
--
-- Safe defaults:
--   - paused_minutes default 0 so callers can omit it.
--   - clock_out_at NULL while a worker is on the clock (one open row per
--     cleaner). Partial unique index enforces "one open entry per cleaner".

CREATE TABLE IF NOT EXISTS public.time_entries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cleaner_id INTEGER NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_out_at TIMESTAMPTZ NULL,
  pause_started_at TIMESTAMPTZ NULL,
  paused_minutes INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'crew_portal' CHECK (source IN ('crew_portal', 'admin_edit', 'auto_clockout')),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open shift per cleaner. Closing a shift (setting clock_out_at)
-- frees the cleaner up for a new entry.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_per_cleaner
  ON public.time_entries (cleaner_id)
  WHERE clock_out_at IS NULL;

-- Hot path: weekly payroll aggregation.
CREATE INDEX IF NOT EXISTS time_entries_payroll_lookup
  ON public.time_entries (tenant_id, cleaner_id, clock_in_at)
  WHERE clock_out_at IS NOT NULL;

-- Cron's auto-clockout scan: who's still on the clock?
CREATE INDEX IF NOT EXISTS time_entries_open_shifts
  ON public.time_entries (tenant_id, cleaner_id)
  WHERE clock_out_at IS NULL;

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Tenant-isolation policy mirrors scripts/05-rls-policies.sql convention.
CREATE POLICY time_entries_tenant_isolation
  ON public.time_entries
  USING (
    tenant_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'tenant_id',
      ''
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_time_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS time_entries_updated_at ON public.time_entries;
CREATE TRIGGER time_entries_updated_at
  BEFORE UPDATE ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_time_entries_updated_at();

COMMENT ON TABLE public.time_entries IS
  'Worker clock-in/out spans. Source of truth for hourly payroll once Wave 3h ships. Drive time between jobs is paid because spans are continuous unless the worker explicitly pauses.';
