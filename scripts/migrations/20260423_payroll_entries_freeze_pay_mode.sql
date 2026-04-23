-- WinBros Round 2 — freeze pay_mode on payroll_entries
-- Also applying the 20260414 revenue_split columns that exist in the code but hadn't
-- actually been applied to this production DB.
-- Keeps per-week payroll rows immutable snapshots of how pay was calculated.

-- UP
ALTER TABLE payroll_entries
  ADD COLUMN IF NOT EXISTS revenue_sold DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue_upsell DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_mode TEXT CHECK (pay_mode IN ('hourly','percentage')) DEFAULT 'hourly';

-- Backfill: existing entries treat all revenue as sold (no upsell tracking existed pre-round-2)
UPDATE payroll_entries
SET revenue_sold = revenue_completed, revenue_upsell = 0
WHERE revenue_sold = 0 AND revenue_completed > 0;

-- Backfill pay_mode for any existing rows: infer from stored pay_percentage vs hourly_rate
UPDATE payroll_entries
SET pay_mode = CASE
  WHEN COALESCE(pay_percentage,0) > 0 AND COALESCE(hourly_rate,0) = 0 THEN 'percentage'
  ELSE 'hourly'
END
WHERE pay_mode IS NULL;

-- DOWN
-- ALTER TABLE payroll_entries DROP COLUMN IF EXISTS pay_mode;
-- (revenue_sold/revenue_upsell intentionally left in — shared with 20260414 migration lineage)
