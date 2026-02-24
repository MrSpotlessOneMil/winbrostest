-- ============================================================================
-- Cedar Rapids Cleaning - Seed Script
-- ============================================================================
-- Tenant already exists in DB (id: 999a1379-31f5-41db-a59b-bd1f3bd1b2c9)
-- This script adds: dashboard user, cleaners, pricing tiers
--
-- Run this in Supabase SQL editor after reviewing all values.
-- ============================================================================

-- ============================================================================
-- CREATE DASHBOARD USER (for owner login)
-- ============================================================================
-- Replace 'CHANGE_ME_PASSWORD' with the actual owner password before running.

INSERT INTO users (tenant_id, username, password_hash, display_name, email)
SELECT
  id,
  'cedar-rapids',
  crypt('CHANGE_ME_PASSWORD', gen_salt('bf')),
  'Cedar Rapids Admin',
  'jaspergrenager@gmail.com'
FROM tenants
WHERE slug = 'cedar-rapids'
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- CLEANERS
-- ============================================================================
-- Replace phone numbers and telegram_id values with real cleaner data.
-- telegram_id is the cleaner's Telegram user ID (they send /myid to the bot).

INSERT INTO cleaners (tenant_id, name, phone, telegram_id, active)
SELECT t.id, 'Cleaner One', '+13195550001', NULL, true FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL
SELECT t.id, 'Cleaner Two', '+13195550002', NULL, true FROM tenants t WHERE t.slug = 'cedar-rapids'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PRICING TIERS (house cleaning - standard & deep clean)
-- ============================================================================

INSERT INTO pricing_tiers (tenant_id, service_type, bedrooms, bathrooms, max_sq_ft, price, price_min, price_max, labor_hours, cleaners, hours_per_cleaner)
SELECT t.id, 'standard', 1, 1,  800,  200,   200,  200,  4,    1, 4    FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'standard', 2, 1,  999,  237.5, 225,  250,  4.5,  1, 4.5  FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'standard', 2, 2, 1250,  262.5, 250,  275,  5.5,  1, 5.5  FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'standard', 3, 2, 1500,  362.5, 350,  375,  7,    2, 3.5  FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'standard', 3, 3, 1999,  400,   375,  425,  8,    2, 4    FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'standard', 4, 2, 2124,  475,   450,  500,  9.5,  2, 4.75 FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'standard', 4, 3, 2374,  525,   500,  550,  10.5, 2, 5.25 FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'deep',     1, 1,  800,  225,   200,  250,  4.5,  1, 4.5  FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'deep',     2, 1,  999,  287.5, 275,  300,  5.5,  1, 5.5  FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'deep',     2, 2, 1250,  325,   300,  350,  6.5,  1, 6.5  FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'deep',     3, 2, 1500,  425,   400,  450,  9,    2, 4.5  FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'deep',     3, 3, 1999,  475,   450,  500,  10,   2, 5    FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'deep',     4, 2, 2001,  625,   600,  650,  13,   2, 6.5  FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'deep',     4, 3, 2499,  725,   700,  750,  15,   2, 7.5  FROM tenants t WHERE t.slug = 'cedar-rapids'
ON CONFLICT (tenant_id, service_type, bedrooms, bathrooms, max_sq_ft) DO NOTHING;

-- ============================================================================
-- PRICING ADD-ONS
-- ============================================================================

INSERT INTO pricing_addons (tenant_id, addon_key, label, minutes, flat_price, price_multiplier, included_in, keywords, active)
SELECT t.id, 'inside_fridge',    'Inside fridge',              30, NULL::DECIMAL(10,2), 1::DECIMAL(5,2), ARRAY['move']::TEXT[],  ARRAY['inside fridge', 'fridge interior']::TEXT[],    true FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'inside_oven',     'Inside oven',                30, NULL::DECIMAL(10,2), 1::DECIMAL(5,2), ARRAY['move']::TEXT[],  ARRAY['inside oven', 'oven interior']::TEXT[],        true FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'inside_cabinets', 'Inside cabinets',            60, NULL::DECIMAL(10,2), 1::DECIMAL(5,2), ARRAY['move']::TEXT[],  ARRAY['inside cabinets', 'cabinet interior']::TEXT[],  true FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'windows_interior','Interior windows',           30, 50::DECIMAL(10,2),   1::DECIMAL(5,2), NULL::TEXT[],            ARRAY['interior windows', 'inside windows']::TEXT[],   true FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'windows_exterior','Exterior windows',           60, 100::DECIMAL(10,2),  1::DECIMAL(5,2), NULL::TEXT[],            ARRAY['exterior windows', 'outside windows']::TEXT[],  true FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'windows_both',    'Interior + exterior windows',90, 150::DECIMAL(10,2),  1::DECIMAL(5,2), NULL::TEXT[],            ARRAY['both windows', 'all windows']::TEXT[],          true FROM tenants t WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT t.id, 'pet_fee',         'Pet fee',                     0, 25::DECIMAL(10,2),   1::DECIMAL(5,2), NULL::TEXT[],            ARRAY['pet', 'pets', 'dog', 'cat']::TEXT[],            true FROM tenants t WHERE t.slug = 'cedar-rapids'
ON CONFLICT (tenant_id, addon_key) DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'Tenant' AS check_name, COUNT(*)::text AS result FROM tenants WHERE slug = 'cedar-rapids'
UNION ALL SELECT 'Dashboard Users', COUNT(*)::text FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT 'Cleaners', COUNT(*)::text FROM cleaners c JOIN tenants t ON c.tenant_id = t.id WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT 'Pricing Tiers', COUNT(*)::text FROM pricing_tiers pt JOIN tenants t ON pt.tenant_id = t.id WHERE t.slug = 'cedar-rapids'
UNION ALL SELECT 'Pricing Add-ons', COUNT(*)::text FROM pricing_addons pa JOIN tenants t ON pa.tenant_id = t.id WHERE t.slug = 'cedar-rapids';

-- ============================================================================
-- WEBHOOK URLS (configure these in the external services)
-- ============================================================================
--
-- VAPI:      https://spotless-scrubbers-api.vercel.app/api/webhooks/vapi/cedar-rapids
-- OpenPhone: https://spotless-scrubbers-api.vercel.app/api/webhooks/openphone/cedar-rapids
-- Telegram:  https://spotless-scrubbers-api.vercel.app/api/webhooks/telegram/cedar-rapids
-- Stripe:    https://spotless-scrubbers-api.vercel.app/api/webhooks/stripe
--
-- Telegram bot webhook setup command:
--   curl "https://api.telegram.org/bot<CEDAR_BOT_TOKEN>/setWebhook?url=https://spotless-scrubbers-api.vercel.app/api/webhooks/telegram/cedar-rapids"
--
-- ============================================================================
