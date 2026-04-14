-- Add revenue_sold and revenue_upsell columns to payroll_entries
-- Splits the existing revenue_completed into sold (original quote) vs upsell (tech added)
-- revenue_completed remains as the total for backward compatibility

ALTER TABLE payroll_entries
  ADD COLUMN IF NOT EXISTS revenue_sold DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue_upsell DECIMAL(10, 2) DEFAULT 0;

-- Backfill: existing entries have all revenue as sold (no upsell tracking existed)
UPDATE payroll_entries
SET revenue_sold = revenue_completed,
    revenue_upsell = 0
WHERE revenue_sold = 0 AND revenue_completed > 0;
