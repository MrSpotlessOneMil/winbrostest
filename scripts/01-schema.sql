-- ============================================================================
-- MULTI-TENANT SCHEMA FOR CLEANING BUSINESS AUTOMATION PLATFORM
-- ============================================================================
-- VERSION: 2.0
-- WARNING: This script DROPS all existing tables and recreates them.
-- Run this only on a fresh database or when you want to start fresh.
--
-- After running this script:
-- 1. Run 03-seed-winbros.sql to add the WinBros tenant
-- 2. Run 04-seed-winbros-cleaners.sql to add cleaners
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop existing tables in reverse dependency order
DROP TABLE IF EXISTS scheduled_tasks CASCADE;
DROP TABLE IF EXISTS system_events CASCADE;
DROP TABLE IF EXISTS pricing_addons CASCADE;
DROP TABLE IF EXISTS pricing_tiers CASCADE;
DROP TABLE IF EXISTS cleaner_assignments CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS upsells CASCADE;
DROP TABLE IF EXISTS tips CASCADE;
DROP TABLE IF EXISTS team_members CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS calls CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS cleaners CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- ============================================================================
-- TENANTS TABLE - Core multi-tenancy table
-- ============================================================================
-- Each row represents one cleaning business client using this platform.
-- All other tables reference this via tenant_id.
-- ============================================================================

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Basic Info
  name TEXT NOT NULL,                              -- Display name: "WinBros Cleaning"
  slug TEXT UNIQUE NOT NULL,                       -- URL-safe identifier: "winbros"

  -- Authentication (for dashboard login)
  email TEXT UNIQUE,                               -- Login email
  password_hash TEXT,                              -- Hashed password (use bcrypt)

  -- Business Info
  business_name TEXT,                              -- Full business name for customer-facing messages
  business_name_short TEXT,                        -- Short name for SMS
  service_area TEXT,                               -- "Los Angeles", "San Diego", etc.
  sdr_persona TEXT DEFAULT 'Mary',                 -- Name used in automated messages

  -- ========== API KEYS (Tenant-Specific) ==========

  -- OpenPhone (SMS/Calls)
  openphone_api_key TEXT,
  openphone_phone_id TEXT,                         -- Phone number ID for sending
  openphone_phone_number TEXT,                     -- Actual phone number for display

  -- VAPI (AI Voice)
  vapi_api_key TEXT,
  vapi_assistant_id TEXT,                          -- Inbound assistant
  vapi_phone_id TEXT,                              -- VAPI phone number ID

  -- HousecallPro (optional - some clients don't use it)
  housecall_pro_api_key TEXT,
  housecall_pro_company_id TEXT,
  housecall_pro_webhook_secret TEXT,

  -- Stripe (Payments)
  stripe_secret_key TEXT,
  stripe_webhook_secret TEXT,

  -- GoHighLevel (optional)
  ghl_location_id TEXT,
  ghl_webhook_secret TEXT,

  -- Telegram (for cleaner notifications)
  telegram_bot_token TEXT,                         -- Each tenant can have their own bot
  owner_telegram_chat_id TEXT,                     -- Owner's chat ID for escalations

  -- Wave Invoicing (optional)
  wave_api_token TEXT,
  wave_business_id TEXT,
  wave_income_account_id TEXT,

  -- ========== WORKFLOW CONFIGURATION ==========

  workflow_config JSONB NOT NULL DEFAULT '{
    "use_housecall_pro": false,
    "use_vapi_inbound": true,
    "use_vapi_outbound": true,
    "use_ghl": false,
    "use_stripe": true,
    "use_wave": false,

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

  -- Owner Contact (for escalations)
  owner_phone TEXT,
  owner_email TEXT,

  -- Google Review Link
  google_review_link TEXT,

  -- Status
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_active ON tenants(active) WHERE active = TRUE;

-- ============================================================================
-- USERS TABLE (for dashboard authentication)
-- ============================================================================

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  email TEXT,

  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_username ON users(username);

-- Password verification function
CREATE OR REPLACE FUNCTION verify_password(password_input TEXT, password_hash TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN password_hash = crypt(password_input, password_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SESSIONS TABLE (for dashboard sessions)
-- ============================================================================

CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ============================================================================
-- CLEANERS TABLE
-- ============================================================================

CREATE TABLE cleaners (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  telegram_id TEXT,                                -- For Telegram notifications
  telegram_username TEXT,                          -- Telegram @username

  -- Team lead status
  is_team_lead BOOLEAN DEFAULT FALSE,

  -- Location for VRP assignment
  home_address TEXT,
  home_lat DECIMAL(10, 8),
  home_lng DECIMAL(11, 8),

  -- Real-time location tracking
  last_location_lat DECIMAL(10, 8),
  last_location_lng DECIMAL(11, 8),
  last_location_accuracy_meters DECIMAL(10, 2),
  last_location_updated_at TIMESTAMPTZ,

  -- Capacity
  max_jobs_per_day INTEGER DEFAULT 3,

  -- Status
  active BOOLEAN DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,                          -- Soft delete
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique cleaner per tenant by phone
  UNIQUE(tenant_id, phone)
);

CREATE INDEX idx_cleaners_tenant ON cleaners(tenant_id);
CREATE INDEX idx_cleaners_telegram ON cleaners(telegram_id);
CREATE INDEX idx_cleaners_active ON cleaners(tenant_id, active) WHERE active = TRUE;
CREATE INDEX idx_cleaners_team_lead ON cleaners(tenant_id, is_team_lead) WHERE is_team_lead = TRUE;

-- ============================================================================
-- CUSTOMERS TABLE
-- ============================================================================

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  phone_number TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  address TEXT,

  -- Customer metadata
  notes TEXT,
  tags TEXT[],

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique customer per tenant by phone
  UNIQUE(tenant_id, phone_number)
);

CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_phone ON customers(tenant_id, phone_number);

-- ============================================================================
-- JOBS TABLE
-- ============================================================================

CREATE TABLE jobs (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Customer link
  customer_id INTEGER REFERENCES customers(id),
  phone_number TEXT,

  -- Job details
  address TEXT,
  service_type TEXT DEFAULT 'Standard Cleaning',
  date DATE,
  scheduled_at TEXT,                               -- Time string like "10:00 AM"

  -- Pricing
  price DECIMAL(10, 2),                            -- Total price
  hours DECIMAL(5, 2),                             -- Estimated hours
  cleaners INTEGER DEFAULT 2,                      -- Number of cleaners needed

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'scheduled', 'in_progress', 'completed', 'cancelled'
  )),
  booked BOOLEAN DEFAULT FALSE,
  paid BOOLEAN DEFAULT FALSE,

  -- Payment tracking
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN (
    'pending', 'deposit_paid', 'fully_paid'
  )),
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT,

  -- Assignment tracking
  cleaner_id INTEGER REFERENCES cleaners(id),
  team_id INTEGER,                                 -- Will reference teams table
  confirmed_at TIMESTAMPTZ,
  cleaner_confirmed BOOLEAN DEFAULT FALSE,
  customer_notified BOOLEAN DEFAULT FALSE,

  -- Completion tracking
  completed_at TIMESTAMPTZ,

  -- Follow-up tracking
  followup_sent_at TIMESTAMPTZ,
  review_requested_at TIMESTAMPTZ,
  monthly_followup_sent_at TIMESTAMPTZ,

  -- External IDs
  housecall_pro_job_id TEXT,

  -- Metadata
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_tenant ON jobs(tenant_id);
CREATE INDEX idx_jobs_customer ON jobs(customer_id);
CREATE INDEX idx_jobs_cleaner ON jobs(cleaner_id);
CREATE INDEX idx_jobs_date ON jobs(tenant_id, date);
CREATE INDEX idx_jobs_status ON jobs(tenant_id, status);
CREATE INDEX idx_jobs_phone ON jobs(tenant_id, phone_number);
CREATE INDEX idx_jobs_followup ON jobs(tenant_id, completed_at, followup_sent_at)
  WHERE completed_at IS NOT NULL AND followup_sent_at IS NULL;

-- ============================================================================
-- LEADS TABLE
-- ============================================================================

CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Source tracking
  source_id TEXT,                                  -- External ID from source system
  source TEXT NOT NULL CHECK (source IN (
    'housecall_pro', 'ghl', 'meta', 'vapi', 'sms', 'website', 'manual', 'phone'
  )),
  ghl_location_id TEXT,

  -- Contact info
  phone_number TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  first_name TEXT,
  last_name TEXT,
  email TEXT,

  -- Lead status
  status TEXT DEFAULT 'new' CHECK (status IN (
    'new', 'contacted', 'qualified', 'booked', 'assigned', 'lost', 'unresponsive', 'nurturing', 'escalated'
  )),

  -- Follow-up tracking
  followup_stage INTEGER DEFAULT 0,
  followup_started_at TIMESTAMPTZ,
  last_contact_at TIMESTAMPTZ,
  next_followup_at TIMESTAMPTZ,

  -- Payment
  stripe_payment_link TEXT,

  -- Conversion
  converted_to_job_id INTEGER REFERENCES jobs(id),

  -- Raw data from source
  form_data JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_tenant ON leads(tenant_id);
CREATE INDEX idx_leads_phone ON leads(tenant_id, phone_number);
CREATE INDEX idx_leads_status ON leads(tenant_id, status);
CREATE INDEX idx_leads_source ON leads(tenant_id, source);
CREATE INDEX idx_leads_followup ON leads(tenant_id, status, followup_stage, next_followup_at)
  WHERE status NOT IN ('booked', 'lost');

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Direction and channel
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT DEFAULT 'sms' CHECK (message_type IN ('sms', 'call', 'email', 'vapi')),

  -- Participants
  phone_number TEXT,
  from_number TEXT,
  to_number TEXT,

  -- Content
  content TEXT,
  role TEXT CHECK (role IN ('client', 'assistant', 'system')),
  ai_generated BOOLEAN DEFAULT FALSE,

  -- Status
  status TEXT DEFAULT 'sent',
  source TEXT,

  -- Links
  customer_id INTEGER REFERENCES customers(id),
  job_id INTEGER REFERENCES jobs(id),
  lead_id INTEGER REFERENCES leads(id),

  -- External IDs
  openphone_message_id TEXT,
  vapi_call_id TEXT,

  -- Extra data
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_tenant ON messages(tenant_id);
CREATE INDEX idx_messages_phone ON messages(tenant_id, phone_number);
CREATE INDEX idx_messages_customer ON messages(customer_id);
CREATE INDEX idx_messages_created ON messages(tenant_id, created_at DESC);

-- ============================================================================
-- CALLS TABLE
-- ============================================================================

CREATE TABLE calls (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Call details
  phone_number TEXT,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  provider TEXT DEFAULT 'vapi',
  provider_call_id TEXT,
  vapi_call_id TEXT,

  -- Caller info
  caller_name TEXT,

  -- Call outcome
  transcript TEXT,
  duration_seconds INTEGER,
  outcome TEXT CHECK (outcome IN ('booked', 'not_booked', 'voicemail', 'callback_scheduled', 'escalated', 'lost')),
  status TEXT DEFAULT 'completed',

  -- Links
  customer_id INTEGER REFERENCES customers(id),
  job_id INTEGER REFERENCES jobs(id),
  lead_id INTEGER REFERENCES leads(id),

  -- Timestamps
  started_at TIMESTAMPTZ,
  date TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calls_tenant ON calls(tenant_id);
CREATE INDEX idx_calls_phone ON calls(tenant_id, phone_number);
CREATE INDEX idx_calls_customer ON calls(customer_id);

-- ============================================================================
-- TEAMS TABLE
-- ============================================================================

CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,                          -- Soft delete

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_teams_tenant ON teams(tenant_id);
CREATE INDEX idx_teams_active ON teams(tenant_id, active) WHERE active = TRUE;

-- Add foreign key to jobs now that teams exists
ALTER TABLE jobs ADD CONSTRAINT jobs_team_fk FOREIGN KEY (team_id) REFERENCES teams(id);

-- ============================================================================
-- TEAM MEMBERS TABLE
-- ============================================================================

CREATE TABLE team_members (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cleaner_id INTEGER NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,

  role TEXT DEFAULT 'member' CHECK (role IN ('lead', 'member', 'technician')),
  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(team_id, cleaner_id)
);

CREATE INDEX idx_team_members_tenant ON team_members(tenant_id);
CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_cleaner ON team_members(cleaner_id);

-- ============================================================================
-- TIPS TABLE
-- ============================================================================

CREATE TABLE tips (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  job_id INTEGER REFERENCES jobs(id),
  team_id INTEGER REFERENCES teams(id),
  cleaner_id INTEGER REFERENCES cleaners(id),

  amount DECIMAL(10, 2) NOT NULL,
  reported_via TEXT CHECK (reported_via IN ('telegram', 'dashboard', 'api', 'manual')),
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tips_tenant ON tips(tenant_id);
CREATE INDEX idx_tips_job ON tips(job_id);
CREATE INDEX idx_tips_created ON tips(tenant_id, created_at DESC);

-- ============================================================================
-- UPSELLS TABLE
-- ============================================================================

CREATE TABLE upsells (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  job_id INTEGER REFERENCES jobs(id),
  team_id INTEGER REFERENCES teams(id),
  cleaner_id INTEGER REFERENCES cleaners(id),

  upsell_type TEXT NOT NULL,
  value DECIMAL(10, 2) DEFAULT 0,
  reported_via TEXT CHECK (reported_via IN ('telegram', 'dashboard', 'api', 'manual')),
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_upsells_tenant ON upsells(tenant_id);
CREATE INDEX idx_upsells_job ON upsells(job_id);
CREATE INDEX idx_upsells_created ON upsells(tenant_id, created_at DESC);

-- ============================================================================
-- REVIEWS TABLE
-- ============================================================================
-- Tracks customer reviews from various sources (Google, SMS, Telegram, etc.)
-- Used for team leaderboards and post-cleaning follow-up tracking.
-- ============================================================================

CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Links
  job_id INTEGER REFERENCES jobs(id),
  customer_id INTEGER REFERENCES customers(id),
  team_id INTEGER REFERENCES teams(id),
  cleaner_id INTEGER REFERENCES cleaners(id),

  -- Review content
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,

  -- Source tracking
  source TEXT CHECK (source IN ('google', 'telegram', 'sms', 'openphone', 'manual', 'website')),
  external_review_url TEXT,                          -- Link to Google review if applicable

  -- Incentive tracking
  incentive_amount DECIMAL(10, 2) DEFAULT 0,         -- Amount paid for review (e.g., $10)
  incentive_paid BOOLEAN DEFAULT FALSE,
  incentive_paid_at TIMESTAMPTZ,

  -- Metadata
  reported_via TEXT CHECK (reported_via IN ('telegram', 'dashboard', 'api', 'webhook', 'manual')),
  verified BOOLEAN DEFAULT FALSE,                    -- Whether review was verified as real

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_tenant ON reviews(tenant_id);
CREATE INDEX idx_reviews_job ON reviews(job_id);
CREATE INDEX idx_reviews_team ON reviews(team_id);
CREATE INDEX idx_reviews_created ON reviews(tenant_id, created_at DESC);
CREATE INDEX idx_reviews_rating ON reviews(tenant_id, rating) WHERE rating IS NOT NULL;

-- ============================================================================
-- CLEANER ASSIGNMENTS TABLE
-- ============================================================================

CREATE TABLE cleaner_assignments (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cleaner_id INTEGER NOT NULL REFERENCES cleaners(id),

  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'confirmed', 'declined', 'cancelled'
  )),

  -- Assignment metadata
  distance_miles DECIMAL(10, 2),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,

  -- Telegram notification tracking
  telegram_message_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cleaner_assignments_tenant ON cleaner_assignments(tenant_id);
CREATE INDEX idx_cleaner_assignments_job ON cleaner_assignments(job_id);
CREATE INDEX idx_cleaner_assignments_cleaner ON cleaner_assignments(cleaner_id);
CREATE INDEX idx_cleaner_assignments_pending ON cleaner_assignments(tenant_id, status)
  WHERE status = 'pending';

-- ============================================================================
-- SYSTEM EVENTS TABLE
-- ============================================================================

CREATE TABLE system_events (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- Can be NULL for system-wide events

  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,

  -- Optional links
  phone_number TEXT,
  job_id TEXT,
  lead_id TEXT,
  cleaner_id TEXT,

  -- Extra data
  metadata JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_system_events_tenant ON system_events(tenant_id);
CREATE INDEX idx_system_events_type ON system_events(event_type);
CREATE INDEX idx_system_events_created ON system_events(created_at DESC);

-- ============================================================================
-- PRICING TIERS TABLE (Per-tenant pricing)
-- ============================================================================
-- Stores pricing matrix for each tenant (bedrooms x bathrooms x service type)
-- ============================================================================

CREATE TABLE pricing_tiers (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Service type: 'standard' or 'deep'
  service_type TEXT NOT NULL CHECK (service_type IN ('standard', 'deep')),

  -- Property dimensions
  bedrooms INTEGER NOT NULL CHECK (bedrooms >= 1 AND bedrooms <= 10),
  bathrooms DECIMAL(3, 1) NOT NULL CHECK (bathrooms >= 1 AND bathrooms <= 10),
  max_sq_ft INTEGER NOT NULL CHECK (max_sq_ft > 0),

  -- Pricing
  price DECIMAL(10, 2) NOT NULL CHECK (price > 0),
  price_min DECIMAL(10, 2),
  price_max DECIMAL(10, 2),

  -- Labor estimates
  labor_hours DECIMAL(5, 2) NOT NULL CHECK (labor_hours > 0),
  cleaners INTEGER NOT NULL DEFAULT 1 CHECK (cleaners >= 1),
  hours_per_cleaner DECIMAL(5, 2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each tenant can only have one price per combination
  UNIQUE(tenant_id, service_type, bedrooms, bathrooms, max_sq_ft)
);

CREATE INDEX idx_pricing_tiers_tenant ON pricing_tiers(tenant_id);
CREATE INDEX idx_pricing_tiers_lookup ON pricing_tiers(tenant_id, service_type, bedrooms, bathrooms);

-- ============================================================================
-- PRICING ADDONS TABLE (Per-tenant add-on pricing)
-- ============================================================================

CREATE TABLE pricing_addons (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Add-on identification
  addon_key TEXT NOT NULL,                              -- 'inside_fridge', 'windows_interior', etc.
  label TEXT NOT NULL,                                  -- Display name

  -- Pricing
  minutes INTEGER NOT NULL DEFAULT 0,                   -- Time in minutes
  flat_price DECIMAL(10, 2),                            -- Flat price (if applicable)
  price_multiplier DECIMAL(5, 2) DEFAULT 1,             -- Multiplier for hourly rate

  -- Inclusion rules
  included_in TEXT[],                                   -- Service types where this is included

  -- Detection keywords
  keywords TEXT[],                                      -- Keywords for auto-detection

  -- Status
  active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each tenant can only have one addon per key
  UNIQUE(tenant_id, addon_key)
);

CREATE INDEX idx_pricing_addons_tenant ON pricing_addons(tenant_id);
CREATE INDEX idx_pricing_addons_key ON pricing_addons(tenant_id, addon_key);

-- ============================================================================
-- SCHEDULED TASKS TABLE (Replaces QStash)
-- ============================================================================

CREATE TABLE scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- Task identification
  task_type TEXT NOT NULL,                         -- 'lead_followup', 'job_reminder', etc.
  task_key TEXT,                                   -- Deduplication key (e.g., 'lead-123-stage-1')

  -- Execution timing
  scheduled_for TIMESTAMPTZ NOT NULL,              -- When to execute

  -- Task payload
  payload JSONB NOT NULL DEFAULT '{}',             -- Task-specific data

  -- Execution tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,

  -- Ensure unique task_key for deduplication
  UNIQUE(task_key)
);

CREATE INDEX idx_scheduled_tasks_due ON scheduled_tasks(scheduled_for, status)
  WHERE status = 'pending';
CREATE INDEX idx_scheduled_tasks_tenant ON scheduled_tasks(tenant_id);
CREATE INDEX idx_scheduled_tasks_type ON scheduled_tasks(task_type, status);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get tenant by slug (used in webhooks)
CREATE OR REPLACE FUNCTION get_tenant_by_slug(p_slug TEXT)
RETURNS tenants AS $$
  SELECT * FROM tenants WHERE slug = p_slug AND active = TRUE LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER cleaners_updated_at BEFORE UPDATE ON cleaners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER scheduled_tasks_updated_at BEFORE UPDATE ON scheduled_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER pricing_tiers_updated_at BEFORE UPDATE ON pricing_tiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER pricing_addons_updated_at BEFORE UPDATE ON pricing_addons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- DONE
-- ============================================================================
-- Next steps:
-- 1. Run this script in Supabase SQL Editor
-- 2. Run 03-seed-winbros.sql to add WinBros as the first tenant
-- 3. Run 04-seed-winbros-cleaners.sql to add cleaners
-- ============================================================================
