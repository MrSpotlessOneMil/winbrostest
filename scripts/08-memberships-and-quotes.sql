-- ============================================================================
-- MEMBERSHIPS & QUOTES — DELTA MIGRATION
-- ============================================================================
-- Tables service_plans, customer_memberships, quotes already exist.
-- This migration applies only the missing changes:
--   1. Add renewal columns to customer_memberships
--   2. Add 'completed' to customer_memberships status CHECK
--   3. Add 'quoted' to jobs status CHECK
--   4. Drop early_cancel_repay from service_plans
--   5. Drop unused credits/stripe_subscription_id from customer_memberships
-- ============================================================================

-- ============================================================================
-- 1. CUSTOMER MEMBERSHIPS — Add renewal flow columns
-- ============================================================================

ALTER TABLE customer_memberships
  ADD COLUMN IF NOT EXISTS renewal_choice TEXT CHECK (renewal_choice IN ('renew', 'cancel')),
  ADD COLUMN IF NOT EXISTS renewal_asked_at TIMESTAMPTZ;

-- ============================================================================
-- 2. CUSTOMER MEMBERSHIPS — Update status CHECK to include 'completed'
-- ============================================================================

ALTER TABLE customer_memberships DROP CONSTRAINT IF EXISTS customer_memberships_status_check;
ALTER TABLE customer_memberships ADD CONSTRAINT customer_memberships_status_check
  CHECK (status IN ('active', 'paused', 'cancelled', 'completed'));

-- ============================================================================
-- 3. JOBS — Update status CHECK to include 'quoted'
-- ============================================================================

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('pending', 'scheduled', 'in_progress', 'completed', 'cancelled', 'quoted'));

-- ============================================================================
-- 4. SERVICE PLANS — Drop early_cancel_repay (no cancel fees)
-- ============================================================================

ALTER TABLE service_plans DROP COLUMN IF EXISTS early_cancel_repay;

-- ============================================================================
-- 5. CUSTOMER MEMBERSHIPS — Drop unused columns
-- ============================================================================

ALTER TABLE customer_memberships DROP COLUMN IF EXISTS credits;
ALTER TABLE customer_memberships DROP COLUMN IF EXISTS stripe_subscription_id;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Confirm renewal columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'customer_memberships' AND table_schema = 'public'
AND column_name IN ('renewal_choice', 'renewal_asked_at');

-- Confirm status CHECKs are correct
SELECT c.conrelid::regclass AS table_name, c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
WHERE c.conrelid IN ('public.customer_memberships'::regclass, 'public.jobs'::regclass)
AND c.contype = 'c'
AND c.conname LIKE '%status%';

-- Confirm early_cancel_repay is gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'service_plans' AND column_name = 'early_cancel_repay';
