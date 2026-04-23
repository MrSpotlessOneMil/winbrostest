-- WinBros Round 2 — pay_mode exclusivity (hourly XOR percentage)
-- Per Max/Dominic decision 2026-04-23: all WinBros techs → hourly @ $25/hr.
-- Ambiguous rows (had both hourly_rate > 0 AND pay_percentage > 0) are zeroed on the pay_percentage
-- so payroll is definitively hourly-only going forward. Salesmen rows (both 0, commission-based)
-- are inert under the new pay_mode column — commission logic is untouched.

-- UP
ALTER TABLE pay_rates ADD COLUMN IF NOT EXISTS pay_mode TEXT
  CHECK (pay_mode IN ('hourly','percentage'))
  DEFAULT 'hourly';

-- Safe-floor backfill: ALL existing rows → hourly.
-- Max confirmed: "just do $25/hr for now" — so zero out pay_percentage for hourly rows.
UPDATE pay_rates
SET pay_mode = 'hourly'
WHERE pay_mode IS NULL;

-- Zero pay_percentage for any row in hourly mode (prevents the old both-fields bug from paying double).
-- Does NOT touch commission_1time_pct / commission_triannual_pct / commission_quarterly_pct etc.
UPDATE pay_rates
SET pay_percentage = 0
WHERE pay_mode = 'hourly' AND pay_percentage > 0;

-- DOWN
-- ALTER TABLE pay_rates DROP COLUMN IF EXISTS pay_mode;
-- (pay_percentage zero-out cannot be cleanly reversed from schema alone — restore from backup if needed.)
