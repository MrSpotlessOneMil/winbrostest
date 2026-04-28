-- Phase F — Appointment-set commission (12.5% pending → earned on conversion).
--
-- Why: Salesmen get 12.5% of the appointment's quoted price the moment an
-- appointment lands on their calendar with crew_salesman_id set, but the
-- credit only EARNS (i.e. pays out via payroll) when that appointment
-- converts into a quoted job. Voided if it never converts (e.g. appointment
-- cancelled or stale > 30 days).
--
-- Linkage decision (Dominic, 2026-04-27): use quotes.appointment_job_id FK
-- back to jobs(id). The salesman quote builder threads the originating
-- appointment job_id through, and quote-conversion uses it to flip the
-- matching credit from pending to earned. NOT customer_id+salesman_id
-- matching (rejected as too loose).

------------------------------------------------------------------------------
-- 1. quotes.appointment_job_id — links a quote back to its appointment job.
------------------------------------------------------------------------------

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS appointment_job_id INTEGER
    REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_appointment_job_id
  ON public.quotes (appointment_job_id)
  WHERE appointment_job_id IS NOT NULL;

COMMENT ON COLUMN public.quotes.appointment_job_id IS
  'Originating sales-appointment jobs.id. Set by the salesman quote builder when the quote is launched from /appointments. Used to flip the salesman_appointment_credits row from pending to earned on quote-conversion.';

------------------------------------------------------------------------------
-- 2. pay_rates.commission_appointment_pct — frozen rate per salesman.
------------------------------------------------------------------------------

ALTER TABLE public.pay_rates
  ADD COLUMN IF NOT EXISTS commission_appointment_pct NUMERIC(5,2) DEFAULT 12.5;

-- Backfill existing salesman rows so they have the default.
UPDATE public.pay_rates
   SET commission_appointment_pct = 12.5
 WHERE role = 'salesman'
   AND commission_appointment_pct IS NULL;

COMMENT ON COLUMN public.pay_rates.commission_appointment_pct IS
  'Percent of the appointment quoted price awarded to the salesman who set it. Frozen per payroll_week at generation time. Defaults to 12.5 per Dominic 2026-04-27.';

------------------------------------------------------------------------------
-- 3. salesman_appointment_credits — one row per appointment-set.
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.salesman_appointment_credits (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  salesman_id     INTEGER NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  appointment_job_id INTEGER NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'earned', 'voided')),
  appointment_price NUMERIC(10,2) NOT NULL,
  frozen_pct      NUMERIC(5,2) NOT NULL,
  amount_pending  NUMERIC(10,2) NOT NULL,
  amount_earned   NUMERIC(10,2),
  converted_quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  payroll_week_id INTEGER REFERENCES public.payroll_weeks(id) ON DELETE SET NULL,
  void_reason     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  earned_at       TIMESTAMPTZ,
  voided_at       TIMESTAMPTZ,
  UNIQUE (appointment_job_id)
);

ALTER TABLE public.salesman_appointment_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY salesman_appointment_credits_tenant_isolation
  ON public.salesman_appointment_credits
  USING (
    tenant_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'tenant_id',
      ''
    )
  );

-- Hot path: payroll generator scans earned + unsettled rows for the tenant.
CREATE INDEX IF NOT EXISTS idx_sac_settle_lookup
  ON public.salesman_appointment_credits (tenant_id, status, payroll_week_id)
  WHERE status = 'earned' AND payroll_week_id IS NULL;

-- Hot path: salesman pending count for /my-day commission chip.
CREATE INDEX IF NOT EXISTS idx_sac_salesman_status
  ON public.salesman_appointment_credits (salesman_id, status);

-- Stale-pending sweeper.
CREATE INDEX IF NOT EXISTS idx_sac_stale_pending
  ON public.salesman_appointment_credits (status, created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.salesman_appointment_credits IS
  'One pending credit logged per sales appointment that has crew_salesman_id + price > 0. Flips to earned when quotes.appointment_job_id matches a converted quote, then settles into payroll_entries via payroll_week_id. Voided if cancelled or > 30 days stale.';

------------------------------------------------------------------------------
-- 4. payroll_entries — record commission_appointment_pct + amount per week.
------------------------------------------------------------------------------

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS commission_appointment_pct NUMERIC(5,2);

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS commission_appointment_amount NUMERIC(10,2) DEFAULT 0;

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS revenue_appointments_set NUMERIC(10,2) DEFAULT 0;

COMMENT ON COLUMN public.payroll_entries.commission_appointment_amount IS
  'Sum of salesman_appointment_credits.amount_earned for credits settled into this payroll_week_id.';

COMMENT ON COLUMN public.payroll_entries.revenue_appointments_set IS
  'Sum of appointment_price for credits settled into this week (audit / display).';
