-- ============================================================================
-- Migration: Multi-Tenant Flow Flags (2026-02-21)
-- ============================================================================
-- Adds per-tenant flow flags to workflow_config for all existing tenants.
-- Uses JSONB merge (||) to safely add new keys without overwriting existing config.
--
-- New flags:
--   use_hcp_mirror           - Mirror jobs/customers into HouseCall Pro
--   use_rainy_day_reschedule - Show rainy day reschedule in dashboard
--   use_team_routing         - Route optimization / optimal job distance
--   use_cleaner_dispatch     - Dispatch cleaner via Telegram after booking
--   use_review_request       - Send review SMS after job completion
--   use_retargeting          - Monthly re-engagement + frequency nudge
--   use_payment_collection   - Stripe deposit + full payment collection flow
-- ============================================================================

-- Default all tenants to "full flow" (backward compatible — existing behavior)
-- Then we'll tune per-tenant below
UPDATE tenants
SET workflow_config = workflow_config || '{
  "use_hcp_mirror": false,
  "use_rainy_day_reschedule": false,
  "use_team_routing": false,
  "use_cleaner_dispatch": true,
  "use_review_request": true,
  "use_retargeting": true,
  "use_payment_collection": true
}'::jsonb
WHERE workflow_config IS NOT NULL
  AND NOT (workflow_config ? 'use_hcp_mirror');

-- ============================================================================
-- WinBros: Full flow (window washing)
-- Call → Booked → Payment → Team routing → Cleaner dispatch → HCP mirror
--       → Rainy day reschedule → Review → Retargeting
-- ============================================================================
UPDATE tenants
SET workflow_config = workflow_config || '{
  "use_hcp_mirror": true,
  "use_rainy_day_reschedule": true,
  "use_team_routing": true,
  "use_cleaner_dispatch": true,
  "use_review_request": true,
  "use_retargeting": true,
  "use_payment_collection": true
}'::jsonb
WHERE slug = 'winbros';

-- ============================================================================
-- Spotless Scrubbers: Full house cleaning flow (no HCP, no rainy day)
-- Call → Booked → Paid → Cleaner dispatched → Review → Retargeting
-- ============================================================================
UPDATE tenants
SET workflow_config = workflow_config || '{
  "use_hcp_mirror": false,
  "use_rainy_day_reschedule": false,
  "use_team_routing": false,
  "use_cleaner_dispatch": true,
  "use_review_request": true,
  "use_retargeting": true,
  "use_payment_collection": true
}'::jsonb
WHERE slug = 'spotless-scrubbers';

-- ============================================================================
-- Cedar Rapids: Simple flow (call → booked → review, no payment/dispatch)
-- ============================================================================
UPDATE tenants
SET workflow_config = workflow_config || '{
  "use_hcp_mirror": false,
  "use_rainy_day_reschedule": false,
  "use_team_routing": false,
  "use_cleaner_dispatch": false,
  "use_review_request": true,
  "use_retargeting": false,
  "use_payment_collection": false
}'::jsonb
WHERE slug = 'cedar-rapids';

-- ============================================================================
-- Verify results
-- ============================================================================
SELECT
  slug,
  name,
  workflow_config->>'use_hcp_mirror' AS hcp_mirror,
  workflow_config->>'use_team_routing' AS team_routing,
  workflow_config->>'use_cleaner_dispatch' AS cleaner_dispatch,
  workflow_config->>'use_review_request' AS review_request,
  workflow_config->>'use_retargeting' AS retargeting,
  workflow_config->>'use_payment_collection' AS payment_collection,
  workflow_config->>'use_rainy_day_reschedule' AS rainy_day
FROM tenants
ORDER BY name;
