-- Phase A — Day-off approval workflow.
--
-- Why: Today /api/actions/time-off auto-approves on insert. Dominic wants
-- admin to approve from Crew Assignment, and techs to see how many days
-- they've put in. The 14-day-advance rule already lives in
-- lib/time-off-validation.ts and stays unchanged.
--
-- Backfill rule: existing rows are treated as already approved so we don't
-- retroactively put workers' booked-off days into a "pending" purgatory.
-- New requests after this migration default to 'pending'.

ALTER TABLE public.time_off
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied'));

ALTER TABLE public.time_off
  ADD COLUMN IF NOT EXISTS decided_by_user_id INTEGER
    REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.time_off
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ NULL;

ALTER TABLE public.time_off
  ADD COLUMN IF NOT EXISTS denial_reason TEXT NULL;

-- Backfill: every row that existed before this migration is approved.
-- The default on the column is 'pending' for new rows; this UPDATE applies
-- only to rows whose decided_at is still NULL (i.e. legacy entries).
UPDATE public.time_off
   SET status = 'approved',
       decided_at = COALESCE(created_at, NOW())
 WHERE status = 'pending'
   AND decided_at IS NULL
   AND created_at < NOW();

-- Hot path: admin queue of pending requests for the tenant.
CREATE INDEX IF NOT EXISTS idx_time_off_tenant_status_date
  ON public.time_off (tenant_id, status, date);

-- Hot path: worker's count of days off in a month.
CREATE INDEX IF NOT EXISTS idx_time_off_cleaner_status_date
  ON public.time_off (cleaner_id, status, date);

COMMENT ON COLUMN public.time_off.status IS
  'pending = awaiting admin decision; approved = counts toward unavailability and shows red on calendar; denied = ignored by scheduler.';
