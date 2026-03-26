-- Set cleaner_pay_percentage to 50% for Spotless Scrubbers and Cedar Rapids
-- Cleaners earn 50% of the job price for these house cleaning tenants
-- WinBros stays on hourly rate (no change)

UPDATE tenants
SET workflow_config = workflow_config || '{"cleaner_pay_percentage": 50}'::jsonb
WHERE slug IN ('spotless-scrubbers', 'cedar-rapids');
