-- ============================================================================
-- SEED WINBROS TENANT
-- ============================================================================
-- Run this after 01-schema.sql to add WinBros as the first tenant.
-- Dashboard login: winbros / test
--
-- IMPORTANT: Replace all {{API_KEY}} placeholders with actual values before running!
-- ============================================================================

-- ============================================================================
-- INSERT WINBROS TENANT
-- ============================================================================

INSERT INTO tenants (
  -- Basic Info
  name,
  slug,
  email,
  password_hash,

  -- Business Info
  business_name,
  business_name_short,
  service_area,
  sdr_persona,

  -- OpenPhone
  openphone_api_key,
  openphone_phone_id,
  openphone_phone_number,

  -- VAPI
  vapi_api_key,
  vapi_assistant_id,
  vapi_phone_id,

  -- HousecallPro
  housecall_pro_api_key,
  housecall_pro_company_id,
  housecall_pro_webhook_secret,

  -- Stripe
  stripe_secret_key,
  stripe_webhook_secret,

  -- GoHighLevel
  ghl_location_id,
  ghl_webhook_secret,

  -- Telegram
  telegram_bot_token,
  owner_telegram_chat_id,

  -- Wave
  wave_api_token,
  wave_business_id,
  wave_income_account_id,

  -- Workflow Config
  workflow_config,

  -- Owner Contact
  owner_phone,
  owner_email,
  google_review_link

) VALUES (
  -- Basic Info
  'WinBros Cleaning',
  'winbros',
  '{{TENANT_EMAIL}}',
  crypt('test', gen_salt('bf')),

  -- Business Info
  'WinBros Cleaning',
  'WinBros',
  'Los Angeles',
  'Mary',

  -- OpenPhone (get from OpenPhone Dashboard -> Settings -> API)
  '{{OPENPHONE_API_KEY}}',
  '{{OPENPHONE_PHONE_ID}}',
  '{{OPENPHONE_PHONE_NUMBER}}',

  -- VAPI (get from VAPI Dashboard -> API Keys)
  '{{VAPI_API_KEY}}',
  '{{VAPI_ASSISTANT_ID}}',
  '{{VAPI_PHONE_ID}}',

  -- HousecallPro (get from HCP Dashboard -> Integrations -> API)
  '{{HOUSECALL_PRO_API_KEY}}',
  '{{HOUSECALL_PRO_COMPANY_ID}}',
  '{{HOUSECALL_PRO_WEBHOOK_SECRET}}',

  -- Stripe (get from Stripe Dashboard -> Developers -> API Keys)
  '{{STRIPE_SECRET_KEY}}',
  '{{STRIPE_WEBHOOK_SECRET}}',

  -- GoHighLevel
  '{{GHL_LOCATION_ID}}',
  NULL,

  -- Telegram (get from BotFather)
  '{{TELEGRAM_BOT_TOKEN}}',
  '{{OWNER_TELEGRAM_CHAT_ID}}',

  -- Wave (get from Wave Dashboard -> Integrations)
  '{{WAVE_API_TOKEN}}',
  '{{WAVE_BUSINESS_ID}}',
  '{{WAVE_INCOME_ACCOUNT_ID}}',

  -- Workflow Config (WinBros uses HousecallPro + full automation)
  '{
    "use_housecall_pro": true,
    "use_vapi_inbound": true,
    "use_vapi_outbound": true,
    "use_ghl": true,
    "use_stripe": true,
    "use_wave": true,

    "lead_followup_enabled": true,
    "lead_followup_stages": 5,
    "skip_calls_for_sms_leads": true,
    "followup_delays_minutes": [0, 10, 15, 20, 30],

    "post_cleaning_followup_enabled": true,
    "post_cleaning_delay_hours": 2,

    "monthly_followup_enabled": true,
    "monthly_followup_days": 30,
    "monthly_followup_discount": "15%",

    "cleaner_assignment_auto": true,
    "require_deposit": true,
    "deposit_percentage": 50
  }'::jsonb,

  -- Owner Contact
  '{{OWNER_PHONE}}',
  '{{OWNER_EMAIL}}',
  NULL
);

-- ============================================================================
-- CREATE DEFAULT USER FOR DASHBOARD LOGIN
-- ============================================================================
-- Login: username = winbros, password = test

INSERT INTO users (tenant_id, username, password_hash, display_name, email)
SELECT
  id,
  'winbros',
  crypt('test', gen_salt('bf')),
  'WinBros Admin',
  '{{TENANT_EMAIL}}'
FROM tenants
WHERE slug = 'winbros';

-- ============================================================================
-- INITIALIZE PRICING FOR WINBROS
-- ============================================================================
-- Insert sample pricing tiers (subset of common bedroom/bathroom combos)

INSERT INTO pricing_tiers (tenant_id, service_type, bedrooms, bathrooms, max_sq_ft, price, price_min, price_max, labor_hours, cleaners, hours_per_cleaner)
SELECT
  t.id,
  'standard',
  1, 1, 800, 200, 200, 200, 4, 1, 4
FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'standard', 2, 1, 999, 237.5, 225, 250, 4.5, 1, 4.5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'standard', 2, 2, 1250, 262.5, 250, 275, 5.5, 1, 5.5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'standard', 3, 2, 1500, 362.5, 350, 375, 7, 2, 3.5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'standard', 3, 2.5, 1749, 387.5, 375, 400, 7.5, 2, 3.75 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'standard', 3, 3, 1999, 400, 375, 425, 8, 2, 4 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'standard', 4, 2, 2124, 475, 450, 500, 9.5, 2, 4.75 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'standard', 4, 2.5, 2249, 500, 475, 525, 9.5, 2, 4.75 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'standard', 4, 3, 2374, 525, 500, 550, 10.5, 2, 5.25 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'standard', 5, 3, 3499, 825, 775, 875, 14.25, 3, 4.75 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 1, 1, 800, 225, 200, 250, 4.5, 1, 4.5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 2, 1, 999, 287.5, 275, 300, 5.5, 1, 5.5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 2, 2, 1250, 325, 300, 350, 6.5, 1, 6.5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 3, 2, 1500, 425, 400, 450, 9, 2, 4.5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 3, 2.5, 1749, 475, 437.5, 512.5, 9.5, 2, 4.75 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 3, 3, 1999, 475, 450, 500, 10, 2, 5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 4, 2, 2001, 625, 600, 650, 13, 2, 6.5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 4, 2.5, 2249, 700, 650, 750, 13.5, 2, 6.75 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 4, 3, 2499, 725, 700, 750, 15, 2, 7.5 FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'deep', 5, 3, 3499, 1050, 1000, 1100, 18.75, 3, 6.25 FROM tenants t WHERE t.slug = 'winbros'
ON CONFLICT (tenant_id, service_type, bedrooms, bathrooms, max_sq_ft) DO NOTHING;

-- Insert pricing add-ons (using explicit casts for NULL values to ensure type consistency in UNION)
INSERT INTO pricing_addons (tenant_id, addon_key, label, minutes, flat_price, price_multiplier, included_in, keywords, active)
SELECT t.id, 'inside_fridge', 'Inside fridge', 30, NULL::DECIMAL(10,2), 1::DECIMAL(5,2), ARRAY['move']::TEXT[], ARRAY['inside fridge', 'fridge interior']::TEXT[], true FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'inside_oven', 'Inside oven', 30, NULL::DECIMAL(10,2), 1::DECIMAL(5,2), ARRAY['move']::TEXT[], ARRAY['inside oven', 'oven interior']::TEXT[], true FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'inside_cabinets', 'Inside cabinets', 60, NULL::DECIMAL(10,2), 1::DECIMAL(5,2), ARRAY['move']::TEXT[], ARRAY['inside cabinets', 'cabinet interior']::TEXT[], true FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'windows_interior', 'Interior windows', 30, 50::DECIMAL(10,2), 1::DECIMAL(5,2), NULL::TEXT[], ARRAY['interior windows', 'inside windows']::TEXT[], true FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'windows_exterior', 'Exterior windows', 60, 100::DECIMAL(10,2), 1::DECIMAL(5,2), NULL::TEXT[], ARRAY['exterior windows', 'outside windows']::TEXT[], true FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'windows_both', 'Interior + exterior windows', 90, 150::DECIMAL(10,2), 1::DECIMAL(5,2), NULL::TEXT[], ARRAY['both windows', 'all windows']::TEXT[], true FROM tenants t WHERE t.slug = 'winbros'
UNION ALL SELECT t.id, 'pet_fee', 'Pet fee', 0, 25::DECIMAL(10,2), 1::DECIMAL(5,2), NULL::TEXT[], ARRAY['pet', 'pets', 'dog', 'cat']::TEXT[], true FROM tenants t WHERE t.slug = 'winbros'
ON CONFLICT (tenant_id, addon_key) DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT
  id,
  name,
  slug,
  email,
  business_name,
  service_area,
  owner_telegram_chat_id,
  (workflow_config->>'use_housecall_pro')::boolean as uses_hcp,
  (workflow_config->>'use_vapi_inbound')::boolean as uses_vapi,
  active
FROM tenants
WHERE slug = 'winbros';

-- Verify pricing was created
SELECT 'Pricing Tiers Count' as check_name, COUNT(*) as count
FROM pricing_tiers pt
JOIN tenants t ON pt.tenant_id = t.id
WHERE t.slug = 'winbros'
UNION ALL
SELECT 'Pricing Addons Count', COUNT(*)
FROM pricing_addons pa
JOIN tenants t ON pa.tenant_id = t.id
WHERE t.slug = 'winbros';

-- ============================================================================
-- WEBHOOK URLS (Configure in external services)
-- ============================================================================
--
-- Production Domain: https://spotless-scrubbers-api.vercel.app
--
-- VAPI:
--   https://spotless-scrubbers-api.vercel.app/api/webhooks/vapi/winbros
--
-- HousecallPro:
--   https://spotless-scrubbers-api.vercel.app/api/webhooks/housecall-pro/winbros
--
-- Stripe:
--   https://spotless-scrubbers-api.vercel.app/api/webhooks/stripe/winbros
--
-- GoHighLevel:
--   https://spotless-scrubbers-api.vercel.app/api/webhooks/ghl/winbros
--
-- OpenPhone:
--   https://spotless-scrubbers-api.vercel.app/api/webhooks/openphone/winbros
--
-- Telegram Bot:
--   https://spotless-scrubbers-api.vercel.app/api/webhooks/telegram/winbros
--
-- ============================================================================
