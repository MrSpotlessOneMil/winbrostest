-- Add permanent auto-response disable toggle
-- Different from auto_response_paused (temporary, auto-unpauses after 15min)
-- auto_response_disabled is set by the owner in the dashboard and NOTHING overrides it.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS auto_response_disabled BOOLEAN DEFAULT false;

-- Set it for known customers Dominic manages manually
-- (Can be done from the dashboard, but setting Victoria and Raza now)
