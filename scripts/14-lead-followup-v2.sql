-- Migration: Lead Follow-Up V2 + SMS Opt-Out Compliance
-- Adds sms_opt_out columns to customers and updates tenant workflow_config

-- SMS opt-out columns
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_opt_out BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_opt_out_at TIMESTAMPTZ;

-- Partial index for fast opt-out lookups in sendSMS()
CREATE INDEX IF NOT EXISTS idx_customers_opt_out
  ON customers(tenant_id, phone_number)
  WHERE sms_opt_out = TRUE;

-- Update all tenants to new 6-stage SMS-only follow-up sequence
UPDATE tenants SET workflow_config = jsonb_set(
  jsonb_set(workflow_config, '{followup_delays_minutes}', '[0, 15, 1440, 4320, 10080, 20160]'::jsonb),
  '{lead_followup_stages}', '6'::jsonb
);
