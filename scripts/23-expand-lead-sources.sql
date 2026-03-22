-- Migration: Expand leads.source CHECK constraint + add discount_type to service_plans
-- Date: 2026-03-22

-- 1. Expand leads.source to include all channels
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check
  CHECK (source IN (
    'housecall_pro', 'ghl', 'meta', 'vapi', 'sms',
    'website', 'manual', 'phone', 'sam', 'google_lsa',
    'thumbtack', 'google', 'email', 'angi'
  ));

-- 2. Add discount_type to service_plans (flat vs percent)
ALTER TABLE service_plans
  ADD COLUMN IF NOT EXISTS discount_type TEXT DEFAULT 'flat';

-- Add CHECK constraint separately (IF NOT EXISTS not supported for constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_plans_discount_type_check'
  ) THEN
    ALTER TABLE service_plans
      ADD CONSTRAINT service_plans_discount_type_check
      CHECK (discount_type IN ('flat', 'percent'));
  END IF;
END $$;
