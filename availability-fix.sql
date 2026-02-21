-- ============================================
-- Availability Column Fix for Cleaners Table
-- ============================================
-- The vapi-choose-team.ts code reads cleaners.availability to determine
-- working hours. Without this column, all cleaners default to 24/7.
-- Run this in Supabase SQL Editor.

-- Step 1: Add the availability column
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS availability jsonb;

-- Step 2: (Optional) Set specific hours for cleaners
-- Null = 24/7 available (default, no action needed)
-- JSON = specific working hours

-- Example: Mon-Fri 8am-6pm
-- UPDATE cleaners SET availability = '{
--   "tz": "America/Los_Angeles",
--   "rules": [
--     {"days": ["MO","TU","WE","TH","FR"], "start": "08:00", "end": "18:00"}
--   ]
-- }'::jsonb
-- WHERE id = <cleaner_id>;

-- Example: Mon-Fri 8am-6pm + Saturday 9am-3pm
-- UPDATE cleaners SET availability = '{
--   "tz": "America/Los_Angeles",
--   "rules": [
--     {"days": ["MO","TU","WE","TH","FR"], "start": "08:00", "end": "18:00"},
--     {"days": ["SA"], "start": "09:00", "end": "15:00"}
--   ]
-- }'::jsonb
-- WHERE id = <cleaner_id>;

-- Example: Set back to 24/7
-- UPDATE cleaners SET availability = NULL WHERE id = <cleaner_id>;

-- Supported day codes: MO, TU, WE, TH, FR, SA, SU
-- Times are in 24-hour format (e.g., "08:00", "18:00")
-- Timezone should match your business timezone
