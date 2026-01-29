# Setup Summary & Next Steps

## ✅ What's Been Completed

### 1. Package Dependencies
- ✅ Updated `package.json` with all required dependencies from spotless-automation
- Added: `@anthropic-ai/sdk`, `openai`, `@upstash/qstash`, `googleapis`, `nodemailer`, `pg`, `stripe`, `tsx`

### 2. Core Library Files (Copied)
- ✅ `lib/supabase.ts` - Comprehensive database operations **WITH availability checking fix**
- ✅ `lib/phone-utils.ts` - Phone number normalization
- ✅ `lib/client-config.ts` - Brand configuration
- ✅ `lib/system-events.ts` - Event logging
- ✅ `lib/json-utils.ts` - JSON parsing utilities
- ✅ `lib/brand-detection.ts` - Multi-brand support

### 3. Documentation Created
- ✅ `IMPLEMENTATION_GUIDE.md` - Complete file copy checklist
- ✅ `SUPABASE_SETUP.md` - Database setup instructions
- ✅ `API_KEYS_NEEDED.md` - All required API keys
- ✅ `scripts/optimized-schema.sql` - Complete database schema

### 4. Features Already in cleaning-business-website
- ✅ Dashboard UI (earnings, leaderboard, teams, rain-day pages)
- ✅ QStash integration (`lib/qstash.ts`)
- ✅ Basic webhook handlers (telegram, housecall-pro)
- ✅ Automation routes (job-broadcast, lead-followup, send-reminder)

## ⚠️ What Still Needs to Be Copied

### Critical Library Files (Copy from `spotless-automation-main/src/lib/`)

1. **`telegram.ts`** - Complete Telegram bot integration (739 lines)
2. **`openphone.ts`** - Complete OpenPhone SMS client (498 lines)
3. **`vapi.ts`** - VAPI transcript parsing (493 lines)
4. **`vapi-choose-team.ts`** - Availability tool (1130+ lines)
5. **`stripe-client.ts`** - Stripe payment handling (680+ lines)
6. **`invoices.ts`** - Wave invoice creation (647 lines)
7. **`pricing-config.ts`** - Pricing tables and add-ons (465 lines)
8. **`pricing-data.json`** - Pricing table data
9. **`ai-responder.ts`** - AI SMS response generation (326 lines)
10. **`llm-update-decider.ts`** - LLM-based update detection (194 lines)
11. **`cleaner-onboarding.ts`** - LLM cleaner onboarding (400+ lines)
12. **`owner-alert.ts`** - Owner SMS alerts
13. **`hubspot.ts`** - HubSpot CRM sync (282 lines)
14. **`docusign.ts`** - DocuSign integration
15. **`connecteam.ts`** - Connecteam shift creation
16. **`weather.ts`** - Weather API integration
17. **`crew-performance.ts`** - Tips/upsells/reviews tracking (491 lines)
18. **`pricing-winbros.ts`** - WinBros-specific pricing
19. **`pricing-insights.ts`** - Dynamic pricing AI
20. **`winbros-alerts.ts`** - WinBros alerts
21. **`admin-auth.ts`** - Admin authentication
22. **`system-control.ts`** - System enable/disable
23. **`telegram-control.ts`** - Telegram control bot
24. **`cascade-scheduler.ts`** - Job scheduling
25. **`live-data.ts`** - Dashboard data
26. **`db.ts`** - Database pooling
27. **`gmail-client.ts`** - Gmail API

### Webhook Handlers (Copy from `spotless-automation-main/src/app/api/webhooks/`)

1. **`vapi/route.ts`** - VAPI call-end handler (477 lines)
2. **`openphone/route.ts`** - OpenPhone SMS handler (919 lines) - **CRITICAL**
3. **`stripe/route.ts`** - Stripe payment webhook (647 lines)
4. **`telegram/route.ts`** - Telegram bot webhook (818 lines) - **CRITICAL**
5. **`telegram-control/route.ts`** - Control bot webhook
6. **`ghl/route.ts`** - GoHighLevel webhook
7. **`housecall-pro/route.ts`** - Housecall Pro webhook (update existing)

### Action Routes (Copy from `spotless-automation-main/src/app/api/actions/`)

1. **`assign-cleaner/route.ts`** - Manual assignment
2. **`send-invoice/route.ts`** - Send invoice
3. **`send-sms/route.ts`** - Send SMS
4. **`send-payment-links/route.ts`** - Payment links
5. **`complete-job/route.ts`** - Complete job
6. **`sync-hubspot/route.ts`** - HubSpot sync

### Cron Jobs (Copy from `spotless-automation-main/src/app/api/cron/`)

1. **`check-timeouts/route.ts`** - Assignment timeout checking (578 lines)
2. **`ghl-followups/route.ts`** - GHL follow-up processing
3. **`send-final-payments/route.ts`** - Final payment links
4. **`send-reminders/route.ts`** - Cleaner reminders
5. **`unified-daily/route.ts`** - Daily unified cron

### VAPI Tool (Copy from `spotless-automation-main/src/app/api/vapi/`)

1. **`choose-team/route.ts`** - Availability tool endpoint

### Integration Files (Copy entire directories)

1. **`integrations/ghl/`** - All files
2. **`integrations/housecall-pro/`** - All files

## 🎯 Priority Order for Copying

### Phase 1: Core Functionality (Do First)
1. `telegram.ts` - Needed for cleaner notifications
2. `openphone.ts` - Needed for SMS
3. `vapi.ts` - Needed for call parsing
4. `stripe-client.ts` - Needed for payments
5. `invoices.ts` - Needed for invoicing
6. `pricing-config.ts` + `pricing-data.json` - Needed for pricing
7. `ai-responder.ts` - Needed for SMS responses
8. `llm-update-decider.ts` - Needed for SMS updates

### Phase 2: Webhooks (Critical)
1. `webhooks/openphone/route.ts` - **MOST CRITICAL** (handles all SMS)
2. `webhooks/vapi/route.ts` - Call processing
3. `webhooks/stripe/route.ts` - Payment processing
4. `webhooks/telegram/route.ts` - Cleaner interactions

### Phase 3: Automation
1. `cron/check-timeouts/route.ts` - Assignment timeouts
2. `cron/ghl-followups/route.ts` - Lead follow-ups
3. `cron/send-final-payments/route.ts` - Final payments
4. `vapi/choose-team/route.ts` - Availability tool

### Phase 4: Optional Features
- GHL integration files
- Housecall Pro integration
- HubSpot, DocuSign, Connecteam
- Weather, crew performance, etc.

## 🚀 Quick Start Commands

After copying files:

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your API keys

# Set up Supabase
# 1. Create Supabase project
# 2. Run scripts/optimized-schema.sql in SQL Editor
# 3. Add your cleaners with availability JSONB

# Run locally
npm run dev

# Set up QStash schedules (after QStash configured)
npm run setup-qstash
```

## 📝 Notes

1. **Availability Checking**: Already fixed in `lib/supabase.ts` - `getCleanerAvailability()` now checks JSONB rules
2. **Booking Flow**: Still needs update - move cleaner assignment from Stripe webhook to email capture
3. **Rain Day**: Already exists but uses mock data - update to use real Supabase queries
4. **Tips/Upsells**: Dashboard pages exist - connect to `crew-performance.ts` library

## Testing Checklist

After setup:
- [ ] Test VAPI webhook with a test call
- [ ] Test OpenPhone webhook with SMS
- [ ] Test Telegram webhook with cleaner response
- [ ] Test Stripe webhook with test payment
- [ ] Test availability tool endpoint
- [ ] Test cron jobs manually
- [ ] Verify cleaner availability checking works
- [ ] Test invoice creation
- [ ] Test payment link generation
