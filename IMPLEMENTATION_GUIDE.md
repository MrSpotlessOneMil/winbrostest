# Complete Implementation Guide

This document outlines all files that need to be copied from `spotless-automation-main` to `cleaning-business-website` to create a fully functional system.

## Files to Copy

### 1. Library Files (`lib/`)

Copy ALL files from `spotless-automation-main/src/lib/` to `cleaning-business-website/lib/`:

**Core Utilities (Already copied):**
- ✅ `supabase.ts` - Comprehensive database operations with availability checking
- ✅ `phone-utils.ts` - Phone number normalization
- ✅ `client-config.ts` - Brand configuration
- ✅ `system-events.ts` - Event logging
- ✅ `json-utils.ts` - JSON parsing utilities
- ✅ `brand-detection.ts` - Multi-brand support

**Still Need to Copy:**
- `telegram.ts` - Telegram bot integration (cleaner notifications)
- `openphone.ts` - OpenPhone SMS API client
- `vapi.ts` - VAPI call transcript parsing
- `vapi-choose-team.ts` - Availability tool for VAPI
- `stripe-client.ts` - Stripe payment handling
- `invoices.ts` - Wave invoice creation
- `pricing-config.ts` - Pricing tables and add-ons
- `pricing-winbros.ts` - WinBros-specific pricing
- `pricing-insights.ts` - Dynamic pricing AI
- `ai-responder.ts` - AI SMS response generation
- `llm-update-decider.ts` - LLM-based customer/job update detection
- `cleaner-onboarding.ts` - LLM-based cleaner onboarding
- `owner-alert.ts` - Owner SMS alerts
- `hubspot.ts` - HubSpot CRM sync
- `docusign.ts` - DocuSign contract sending
- `connecteam.ts` - Connecteam shift creation
- `weather.ts` - Weather API integration
- `crew-performance.ts` - Tips/upsells/reviews tracking
- `winbros-alerts.ts` - WinBros-specific alerts
- `admin-auth.ts` - Admin authentication
- `system-control.ts` - System enable/disable controls
- `telegram-control.ts` - Telegram control bot
- `cascade-scheduler.ts` - Job scheduling logic
- `live-data.ts` - Dashboard data fetching
- `db.ts` - Database connection pooling
- `gmail-client.ts` - Gmail API client

### 2. Webhook Handlers (`app/api/webhooks/`)

Copy ALL files from `spotless-automation-main/src/app/api/webhooks/`:

- `vapi/route.ts` - VAPI call-end webhook handler
- `openphone/route.ts` - OpenPhone SMS webhook handler (1800+ lines)
- `stripe/route.ts` - Stripe payment webhook handler
- `telegram/route.ts` - Telegram bot webhook handler (900+ lines)
- `telegram-control/route.ts` - Telegram control bot webhook
- `ghl/route.ts` - GoHighLevel webhook handler
- `housecall-pro/route.ts` - Housecall Pro webhook handler

### 3. Action Routes (`app/api/actions/`)

Copy ALL files from `spotless-automation-main/src/app/api/actions/`:

- `assign-cleaner/route.ts` - Manual cleaner assignment
- `send-invoice/route.ts` - Send invoice manually
- `send-sms/route.ts` - Send SMS manually
- `send-payment-links/route.ts` - Send payment links
- `complete-job/route.ts` - Mark job as completed
- `sync-hubspot/route.ts` - Sync to HubSpot manually

### 4. Cron Jobs (`app/api/cron/`)

Copy ALL files from `spotless-automation-main/src/app/api/cron/`:

- `check-timeouts/route.ts` - Check assignment timeouts and escalate
- `ghl-followups/route.ts` - Process GHL follow-up queue
- `send-final-payments/route.ts` - Send final payment links
- `send-reminders/route.ts` - Send cleaner reminders
- `unified-daily/route.ts` - Daily unified cron job

### 5. VAPI Tool (`app/api/vapi/`)

Copy from `spotless-automation-main/src/app/api/vapi/`:

- `choose-team/route.ts` - Availability tool endpoint

### 6. Integration Files (`integrations/`)

Copy entire directories from `spotless-automation-main/src/integrations/`:

- `ghl/` - GoHighLevel integration (all files)
- `housecall-pro/` - Housecall Pro integration (all files)

### 7. Scripts (`scripts/`)

Copy from `spotless-automation-main/scripts/`:

- `setup-qstash-schedule.ts` - QStash schedule setup
- `optimized-schema.sql` - Complete database schema
- `migrate-to-optimized-schema.sql` - Migration script (if needed)
- `setup-system-events.sql` - System events table setup

## Features to Implement

### 1. Availability Checking with JSONB Rules ✅
- Already implemented in `lib/supabase.ts` - `getCleanerAvailability()` now checks availability rules
- Function `isCleanerAvailableByRules()` validates cleaner availability windows

### 2. QStash Integration
- Copy `lib/qstash.ts` from cleaning-business-website (already exists)
- Update to match spotless-automation patterns
- Add scheduled workflows for lead follow-up, job broadcast, reminders

### 3. Rain Day Rescheduling
- Already exists in `app/api/rain-day/route.ts`
- Enhance to use actual Supabase queries instead of mock data
- Integrate with weather API if needed

### 4. Tips & Upsells Tracking
- Already exists in dashboard pages
- Integrate with `crew-performance.ts` library
- Connect to Telegram webhook for tip/upsell reporting

### 5. Leaderboard
- Already exists in dashboard
- Connect to `crew-performance.ts` for real data
- Add API endpoint for leaderboard data

## Missing Features to Add

1. **Booking Completion Flow Fix**
   - Move cleaner assignment trigger from Stripe webhook to email capture
   - Update `app/api/webhooks/openphone/route.ts` to assign cleaners when email provided

2. **Availability Tool Enhancement**
   - Ensure `vapi-choose-team.ts` properly filters by availability rules
   - Update assignment logic to respect availability windows

3. **Housecall Pro Integration**
   - Complete bidirectional sync
   - Enable strict webhook validation

## Next Steps

1. Copy all remaining library files
2. Copy all webhook handlers
3. Copy all action routes
4. Copy all cron jobs
5. Update existing routes to use real Supabase queries
6. Test end-to-end flows
