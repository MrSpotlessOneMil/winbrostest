# Complete Setup Instructions

## ✅ What's Already Done

1. **Package.json** - All dependencies added
2. **Core Library Files** - supabase.ts (with availability fix), phone-utils, client-config, system-events, json-utils, brand-detection
3. **Documentation** - Implementation guide, Supabase setup, API keys needed
4. **Database Schema** - Complete optimized schema in `scripts/optimized-schema.sql`

## 📋 What You Need to Do

### Step 1: Copy Remaining Library Files

Copy these files from `spotless-automation-main/src/lib/` to `cleaning-business-website/lib/`:

**Critical (Copy These First):**
- `telegram.ts` - Telegram bot functions
- `openphone.ts` - OpenPhone SMS client  
- `vapi.ts` - VAPI transcript parsing
- `vapi-choose-team.ts` - Availability tool
- `stripe-client.ts` - Stripe payments
- `invoices.ts` - Wave invoices
- `pricing-config.ts` - Pricing logic
- `pricing-data.json` - Pricing table (large file, ~2000 lines)
- `ai-responder.ts` - AI SMS responses
- `llm-update-decider.ts` - LLM update detection

**Also Copy:**
- `cleaner-onboarding.ts`
- `owner-alert.ts`
- `hubspot.ts`
- `docusign.ts`
- `connecteam.ts`
- `weather.ts`
- `crew-performance.ts`
- `pricing-winbros.ts`
- `pricing-insights.ts`
- `winbros-alerts.ts`
- `admin-auth.ts`
- `system-control.ts`
- `telegram-control.ts`
- `cascade-scheduler.ts`
- `live-data.ts`
- `db.ts`
- `gmail-client.ts`

### Step 2: Copy Webhook Handlers

Copy from `spotless-automation-main/src/app/api/webhooks/` to `cleaning-business-website/app/api/webhooks/`:

- `vapi/route.ts` - VAPI webhook
- `openphone/route.ts` - OpenPhone webhook (REPLACE existing)
- `stripe/route.ts` - Stripe webhook
- `telegram/route.ts` - Telegram webhook (ENHANCE existing)
- `telegram-control/route.ts` - Control bot
- `ghl/route.ts` - GHL webhook
- `housecall-pro/route.ts` - HCP webhook (ENHANCE existing)

### Step 3: Copy Action Routes

Copy from `spotless-automation-main/src/app/api/actions/` to `cleaning-business-website/app/api/actions/`:

- `assign-cleaner/route.ts`
- `send-invoice/route.ts`
- `send-sms/route.ts`
- `send-payment-links/route.ts`
- `complete-job/route.ts`
- `sync-hubspot/route.ts`

### Step 4: Copy Cron Jobs

Copy from `spotless-automation-main/src/app/api/cron/` to `cleaning-business-website/app/api/cron/`:

- `check-timeouts/route.ts`
- `ghl-followups/route.ts`
- `send-final-payments/route.ts`
- `send-reminders/route.ts`
- `unified-daily/route.ts`

### Step 5: Copy VAPI Tool

Copy from `spotless-automation-main/src/app/api/vapi/`:
- `choose-team/route.ts` → `cleaning-business-website/app/api/vapi/choose-team/route.ts`

### Step 6: Copy Integration Directories

Copy entire directories:
- `spotless-automation-main/src/integrations/ghl/` → `cleaning-business-website/integrations/ghl/`
- `spotless-automation-main/src/integrations/housecall-pro/` → `cleaning-business-website/integrations/housecall-pro/`

### Step 7: Set Up Environment Variables

1. Copy the template from `API_KEYS_NEEDED.md`
2. Create `.env.local` file
3. Fill in all REQUIRED variables:
   - Supabase URL and service role key
   - OpenPhone API key and phone ID
   - VAPI API key and assistant ID
   - Stripe secret key
   - Telegram bot token
   - OpenAI or Anthropic API key
   - QStash token (for scheduled tasks)

### Step 8: Set Up Supabase

1. Create Supabase project at supabase.com
2. Open SQL Editor
3. Copy and paste `scripts/optimized-schema.sql`
4. Execute the script
5. Verify tables created:
   ```sql
   SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
   ```
6. Add your cleaners:
   ```sql
   INSERT INTO cleaners (name, phone, telegram_id, active, availability) VALUES
   ('Cleaner Name', '+15551234567', 'telegram-chat-id', true, '{
     "tz": "America/Los_Angeles",
     "rules": [{"days": ["MO","TU","WE","TH","FR"], "start": "09:00", "end": "17:00"}],
     "is24_7": false
   }'::jsonb);
   ```

### Step 9: Install and Run

```bash
npm install
npm run dev
```

### Step 10: Set Up QStash Schedules

After QStash is configured:
```bash
npm run setup-qstash
```

## 🔧 Key Fixes Applied

1. **Availability Checking** ✅
   - Updated `getCleanerAvailability()` in `lib/supabase.ts`
   - Now checks JSONB availability rules before assignment
   - Function `isCleanerAvailableByRules()` validates cleaner availability windows

2. **Package Dependencies** ✅
   - All required packages added to package.json

## 📝 Important Notes

1. **Cleaner Availability Format**: Must be JSONB:
   ```json
   {
     "tz": "America/Los_Angeles",
     "rules": [
       {"days": ["MO","TU","WE","TH","FR"], "start": "09:00", "end": "17:00"}
     ],
     "is24_7": false
   }
   ```

2. **Phone Numbers**: Always stored in E.164 format (+1XXXXXXXXXX)

3. **Timezone**: Default is America/Los_Angeles (PST/PDT)

4. **Booking Flow**: Currently assigns cleaners after Stripe payment. To change to email capture, update `openphone/route.ts` webhook handler.

## 🧪 Testing

Test each webhook:
- VAPI: Make test call → should create job
- OpenPhone: Send SMS → should get AI response
- Telegram: Cleaner responds → should update assignment
- Stripe: Test payment → should mark job paid

## Need Help?

See:
- `IMPLEMENTATION_GUIDE.md` - Complete file list
- `SUPABASE_SETUP.md` - Database setup
- `API_KEYS_NEEDED.md` - All required keys
