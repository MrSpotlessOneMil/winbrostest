-- Phase N — Payroll commission split (Blake call 2026-04-28).
--
-- Why: Blake locked in three payroll details on the call.
--
-- 1. Salesmen get 20% on door-knock quotes (they generated the lead) but
--    only 12.5% on appointment-converted quotes (we paid for the lead via
--    Meta ads, so the salesman is doing less work). The 12.5% side already
--    ships via Phase F's salesman_appointment_credits ledger, but the 20%
--    door-knock side needs its own rate column on pay_rates and a flag on
--    quotes so the payroll engine can tell the two apart.
--
-- 2. Tech upsell commission pays a different % from the tech's base pay
--    (e.g. base 20% of revenue but 40% of upsell). pay_rates currently
--    only carries pay_percentage which collapses both into one rate.
--
-- 3. Frequency (one-time / tri-annual / quarterly) NO LONGER affects the
--    salesman rate — it's just door-knock vs appointment now. We keep the
--    legacy commission_1time_pct / _triannual_pct / _quarterly_pct columns
--    so historical payroll weeks render correctly, but new weeks settle
--    via the door-knock + appointment columns only.

----------------------------------------------------------------------------
-- 1. quotes.is_appointment_quote — set true when salesman uses the
--    "Convert appointment → quote" flow. Backfill from the existing
--    appointment_job_id linkage so historical credits classify correctly.
----------------------------------------------------------------------------

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS is_appointment_quote BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.quotes
   SET is_appointment_quote = TRUE
 WHERE appointment_job_id IS NOT NULL
   AND is_appointment_quote = FALSE;

CREATE INDEX IF NOT EXISTS idx_quotes_is_appointment_quote
  ON public.quotes (tenant_id, is_appointment_quote)
  WHERE is_appointment_quote = TRUE;

COMMENT ON COLUMN public.quotes.is_appointment_quote IS
  'TRUE when this quote was created via the salesman "Convert appointment → quote" button (12.5% commission). FALSE when the salesman door-knocked the lead themselves (20% commission). Backfilled from appointment_job_id IS NOT NULL.';

----------------------------------------------------------------------------
-- 2. pay_rates.commission_doorknock_pct — door-knock rate for salesmen.
----------------------------------------------------------------------------

ALTER TABLE public.pay_rates
  ADD COLUMN IF NOT EXISTS commission_doorknock_pct NUMERIC(5,2) DEFAULT 20;

UPDATE public.pay_rates
   SET commission_doorknock_pct = 20
 WHERE role = 'salesman'
   AND commission_doorknock_pct IS NULL;

COMMENT ON COLUMN public.pay_rates.commission_doorknock_pct IS
  'Salesman commission % on quotes flagged is_appointment_quote=false. Default 20 per Blake (2026-04-28). Frozen per payroll_week.';

----------------------------------------------------------------------------
-- 3. pay_rates.commission_upsell_pct — separate tech upsell rate.
----------------------------------------------------------------------------

ALTER TABLE public.pay_rates
  ADD COLUMN IF NOT EXISTS commission_upsell_pct NUMERIC(5,2);

-- Default to the worker's existing pay_percentage so nobody sees a sudden
-- pay cut from the migration. Admins can split the rate later.
UPDATE public.pay_rates
   SET commission_upsell_pct = pay_percentage
 WHERE role IN ('technician', 'team_lead')
   AND commission_upsell_pct IS NULL;

COMMENT ON COLUMN public.pay_rates.commission_upsell_pct IS
  'Technician/Team-lead commission % on technician_upsell line items (separate from base pay_percentage). NULL = use pay_percentage. Frozen per payroll_week.';

----------------------------------------------------------------------------
-- 4. payroll_entries — new columns for the split + display.
----------------------------------------------------------------------------

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS revenue_doorknock NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_doorknock_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS commission_doorknock_amount NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_upsell_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS commission_upsell_amount NUMERIC(10,2) DEFAULT 0;

COMMENT ON COLUMN public.payroll_entries.revenue_doorknock IS
  'Original-quote revenue from non-appointment (door-knock) quotes credited to this salesman during the week.';
COMMENT ON COLUMN public.payroll_entries.commission_doorknock_pct IS
  'Frozen door-knock commission rate at the time this payroll week was generated.';
COMMENT ON COLUMN public.payroll_entries.commission_doorknock_amount IS
  'revenue_doorknock × commission_doorknock_pct / 100. Folded into total_pay.';
COMMENT ON COLUMN public.payroll_entries.commission_upsell_pct IS
  'Frozen tech-upsell commission rate at the time this payroll week was generated.';
COMMENT ON COLUMN public.payroll_entries.commission_upsell_amount IS
  'revenue_upsell × commission_upsell_pct / 100. Folded into total_pay.';
