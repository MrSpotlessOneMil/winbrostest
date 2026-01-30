-- ============================================================================
-- SEED WINBROS TENANT
-- ============================================================================
-- Run this after multi-tenant-schema.sql to add WinBros as the first tenant.
--
-- IMPORTANT: Replace all [PLACEHOLDER] values with your actual API keys!
-- Password: test
-- ============================================================================

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- INSERT WINBROS TENANT
-- ============================================================================

INSERT INTO tenants (
  -- Basic Info
  name,
  slug,

  -- Authentication
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

  -- Telegram (using shared bot)
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

  -- Authentication (password: test)
  '[YOUR_EMAIL]@gmail.com',
  crypt('test', gen_salt('bf')),

  -- Business Info
  'WinBros Cleaning',
  'WinBros',
  'Los Angeles',
  'Mary',

  -- OpenPhone - Get from OpenPhone Dashboard > Settings > API
  '[YOUR_OPENPHONE_API_KEY]',
  '[YOUR_OPENPHONE_PHONE_ID]',
  '[YOUR_OPENPHONE_PHONE_NUMBER_ID]',

  -- VAPI - Get from VAPI Dashboard
  '[YOUR_VAPI_API_KEY]',
  '[YOUR_VAPI_ASSISTANT_ID]',
  '[YOUR_VAPI_PHONE_ID]',

  -- HousecallPro - Get from HCP Dashboard > Settings > API
  '[YOUR_HCP_API_KEY]',
  '[YOUR_HCP_COMPANY_ID]',
  '[YOUR_HCP_WEBHOOK_SECRET]',

  -- Stripe - Get from Stripe Dashboard > Developers > API Keys
  '[YOUR_STRIPE_SECRET_KEY]',  -- sk_live_... or sk_test_...
  '[YOUR_STRIPE_WEBHOOK_SECRET]',  -- whsec_...

  -- GoHighLevel - Get from GHL Dashboard
  '[YOUR_GHL_LOCATION_ID]',
  NULL,  -- GHL webhook secret (if applicable)

  -- Telegram - Get from BotFather
  '[YOUR_TELEGRAM_BOT_TOKEN]',  -- Format: 123456789:ABC...
  NULL,  -- Owner chat ID - run /myid in your bot to get this

  -- Wave - Get from Wave Dashboard > Settings > Integrations
  '[YOUR_WAVE_API_TOKEN]',
  '[YOUR_WAVE_BUSINESS_ID]',
  '[YOUR_WAVE_INCOME_ACCOUNT_ID]',

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
  '+1[YOUR_PHONE]',
  '[YOUR_EMAIL]@gmail.com',
  NULL  -- Set Google review link when available
);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify tenant was created
SELECT
  id,
  name,
  slug,
  email,
  business_name,
  service_area,
  (workflow_config->>'use_housecall_pro')::boolean as uses_hcp,
  active
FROM tenants
WHERE slug = 'winbros';

-- ============================================================================
-- POST-SETUP: Update with your actual values
-- ============================================================================
--
-- After running this script with placeholders, update with real values:
--
-- UPDATE tenants SET
--   openphone_api_key = 'your_real_key',
--   stripe_secret_key = 'sk_live_...',
--   -- etc...
-- WHERE slug = 'winbros';
--
-- ============================================================================
-- WEBHOOK URLs (configure in external services):
-- ============================================================================
--
-- Replace [YOUR_DOMAIN] with your Vercel deployment URL
--
-- VAPI:
--   https://[YOUR_DOMAIN]/api/webhooks/vapi/winbros
--
-- HousecallPro:
--   https://[YOUR_DOMAIN]/api/webhooks/housecall-pro/winbros
--
-- Stripe:
--   https://[YOUR_DOMAIN]/api/webhooks/stripe/winbros
--
-- GoHighLevel:
--   https://[YOUR_DOMAIN]/api/webhooks/ghl/winbros
--
-- OpenPhone:
--   https://[YOUR_DOMAIN]/api/webhooks/openphone/winbros
--
-- Telegram Bot:
--   https://[YOUR_DOMAIN]/api/webhooks/telegram/winbros
--
-- ============================================================================
