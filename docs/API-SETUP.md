# API Setup Guide

Complete guide for configuring all APIs, webhooks, and integrations for the WinBros Cleaning Automation Platform.

---

## Table of Contents

1. [Environment Variables (Global)](#environment-variables-global)
2. [Per-Tenant API Keys (Database)](#per-tenant-api-keys-database)
3. [Webhook Configuration](#webhook-configuration)
4. [Cron Job Configuration](#cron-job-configuration)
5. [Service-by-Service Setup](#service-by-service-setup)

---

## Required vs Optional Services

| Service | Required | Purpose |
|---------|----------|---------|
| Supabase | **Yes** | Database |
| OpenPhone | **Yes** | SMS/calls with customers |
| VAPI | **Yes** | AI phone calls |
| HousecallPro | **Yes** | Job management |
| Stripe | **Yes** | Payments |
| Telegram | **Yes** | Cleaner notifications |
| Anthropic AI | **Yes** | Intent analysis |
| Gmail | Optional | Email confirmations to customers |
| GoHighLevel | Optional | CRM integration |
| Wave | Optional | Professional invoicing |

---

## Environment Variables (Global)

These are configured in `.env.local` (local) or Vercel Environment Variables (production).

### Supabase (Required)

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) | Supabase Dashboard → Settings → API → service_role |

**Settings:**
- Enable Row Level Security (RLS) on all tables
- Run `scripts/01-schema.sql` to create tables

---

### AI APIs

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `ANTHROPIC_API_KEY` | Claude API for AI intent analysis | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `OPENAI_API_KEY` | OpenAI API (backup/optional) | [platform.openai.com](https://platform.openai.com) → API Keys |

**Usage:** Used in `lib/ai-intent.ts` for analyzing customer messages and booking intent.

---

### Gmail (Email Notifications)

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `GMAIL_USER` | Gmail email address | Your Gmail account |
| `GMAIL_APP_PASSWORD` | Gmail App Password | Google Account → Security → 2-Step Verification → App passwords |

**Settings:**
1. Enable 2-Step Verification on your Google account
2. Create an App Password (select "Mail" and "Other")
3. Use the 16-character password generated

---

### Cron Authentication

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `CRON_SECRET` | Secret for cron job authentication | Generate: `openssl rand -hex 32` |

**Usage:** Vercel cron jobs and internal automation endpoints use this for authentication.

---

### Internal Task Scheduler

The system uses a **database-backed task scheduler** instead of external services like QStash:

- Tasks are stored in the `scheduled_tasks` table
- A Vercel cron job (`/api/cron/process-scheduled-tasks`) runs every minute
- Processes due tasks and dispatches them to automation endpoints

**Scheduled Task Types:**
- `lead_followup` - Multi-stage lead follow-up sequence
- `job_broadcast` - Cleaner assignment notifications
- `day_before_reminder` - Customer reminders
- `post_cleaning_followup` - Review requests
- `job_reminder` - Cleaner job reminders

**No additional configuration required** - the scheduler uses Supabase and Vercel cron.

---

### Brand Configuration (Optional)

| Variable | Description |
|----------|-------------|
| `BUSINESS_NAME` | Full business name |
| `BUSINESS_NAME_SHORT` | Short name for SMS |
| `NEXT_PUBLIC_DOMAIN` | Production domain URL |
| `SERVICE_AREA` | Default service area |
| `SDR_PERSONA` | AI persona name (e.g., "Mary") |

---

## Per-Tenant API Keys (Database)

These are stored in the `tenants` table for multi-tenant support. Each tenant has their own set of API keys.

### Tenant Table Fields

```sql
-- OpenPhone
openphone_api_key        -- API key for SMS/calls
openphone_phone_id       -- Phone number ID for sending
openphone_phone_number   -- Display phone number

-- VAPI
vapi_api_key             -- VAPI API key
vapi_assistant_id        -- Inbound assistant ID
vapi_phone_id            -- VAPI phone number ID

-- HousecallPro
housecall_pro_api_key    -- HCP API key
housecall_pro_company_id -- HCP company ID
housecall_pro_webhook_secret -- Webhook signature verification

-- Stripe
stripe_secret_key        -- Stripe secret key (sk_live_xxx)
stripe_webhook_secret    -- Webhook signature (whsec_xxx)

-- GoHighLevel
ghl_location_id          -- GHL location ID
ghl_webhook_secret       -- Webhook signature verification

-- Telegram
telegram_bot_token       -- Bot token from BotFather
owner_telegram_chat_id   -- Owner's chat ID for alerts

-- Wave Invoicing
wave_api_token           -- Wave API token
wave_business_id         -- Wave business ID
wave_income_account_id   -- Income account for invoices
```

---

## Webhook Configuration

Production Domain: `https://spotless-scrubbers-api.vercel.app`

### Webhook Endpoints

| Service | Endpoint | Events |
|---------|----------|--------|
| OpenPhone | `/api/webhooks/openphone` | Inbound SMS |
| VAPI | `/api/webhooks/vapi` | Call end events |
| HousecallPro | `/api/webhooks/housecall-pro` | Lead/job updates |
| Stripe | `/api/webhooks/stripe` | Payment events |
| GoHighLevel | `/api/webhooks/ghl` | Contact updates |
| Telegram | `/api/webhooks/telegram` | Bot callbacks |

---

## Cron Job Configuration

Configure these in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/process-scheduled-tasks",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/check-timeouts",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/cron/post-job-followup",
      "schedule": "*/15 * * * *"
    },
    {
      "path": "/api/cron/send-reminders",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/cron/monthly-reengagement",
      "schedule": "0 10 * * *"
    }
  ]
}
```

---

## Service-by-Service Setup

### 1. OpenPhone

**Purpose:** SMS and voice communications with customers.

**Where to Get Keys:**
1. Log in to [OpenPhone Dashboard](https://my.openphone.com)
2. Go to **Settings** → **API**
3. Copy your API key

**Required Values:**
| Field | Where to Find |
|-------|---------------|
| `openphone_api_key` | Settings → API → API Key |
| `openphone_phone_id` | Settings → Phone Numbers → Click number → Copy ID from URL |
| `openphone_phone_number` | The actual phone number (e.g., `+14155551234`) |

**Webhook Setup:**
1. Go to **Settings** → **Webhooks**
2. Add webhook URL: `https://spotless-scrubbers-api.vercel.app/api/webhooks/openphone`
3. Select events: `message.received`
4. Copy the **Signing Secret** to `OPENPHONE_WEBHOOK_SECRET` (env var, not per-tenant)

**How it Operates:**
- Receives inbound SMS via webhook
- Analyzes message intent using AI
- Creates leads in HCP if booking intent detected
- Sends automated responses and follow-ups

---

### 2. VAPI (AI Voice)

**Purpose:** AI-powered inbound and outbound phone calls.

**Where to Get Keys:**
1. Log in to [VAPI Dashboard](https://dashboard.vapi.ai)
2. Go to **API Keys** section

**Required Values:**
| Field | Where to Find |
|-------|---------------|
| `vapi_api_key` | Dashboard → API Keys → Create/Copy key |
| `vapi_assistant_id` | Assistants → Select assistant → Copy ID |
| `vapi_phone_id` | Phone Numbers → Select number → Copy ID |

**Assistant Setup:**
1. Create an assistant with your business context
2. Configure the voice (e.g., "shimmer" for female voice)
3. Set up the system prompt for cleaning bookings

**Webhook Setup:**
1. Go to **Settings** → **Webhooks**
2. Add Server URL: `https://spotless-scrubbers-api.vercel.app/api/webhooks/vapi`
3. Enable `call.ended` events

**How it Operates:**
- Handles inbound calls with AI assistant
- Parses call transcripts for booking details
- Creates leads from call data
- Triggers follow-up sequences

---

### 3. HousecallPro

**Purpose:** Job management, scheduling, and customer records.

**Where to Get Keys:**
1. Log in to [HousecallPro Dashboard](https://pro.housecallpro.com)
2. Go to **Settings** → **Integrations** → **API**

**Required Values:**
| Field | Where to Find |
|-------|---------------|
| `housecall_pro_api_key` | Integrations → API → API Key |
| `housecall_pro_company_id` | Integrations → API → Company ID |
| `housecall_pro_webhook_secret` | Webhooks → Create webhook → Secret |

**Webhook Setup:**
1. Go to **Settings** → **Integrations** → **Webhooks**
2. Add webhook URL: `https://spotless-scrubbers-api.vercel.app/api/webhooks/housecall-pro`
3. Select events:
   - `lead.created`
   - `lead.updated`
   - `job.created`
   - `job.updated`
   - `job.scheduled`
   - `job.completed`
   - `job.canceled`
   - `customer.created`
   - `customer.updated`
4. Copy the webhook secret

**How it Operates:**
- Source of truth for jobs and customers
- Receives webhooks for job status changes
- Two-way sync: creates leads/jobs from automation
- Updates local database to mirror HCP state

---

### 4. Stripe

**Purpose:** Payment processing for deposits and final payments.

**Where to Get Keys:**
1. Log in to [Stripe Dashboard](https://dashboard.stripe.com)
2. Go to **Developers** → **API Keys**

**Required Values:**
| Field | Where to Find |
|-------|---------------|
| `stripe_secret_key` | API Keys → Secret key (sk_live_xxx or sk_test_xxx) |
| `stripe_webhook_secret` | Webhooks → Select endpoint → Signing secret |

**Webhook Setup:**
1. Go to **Developers** → **Webhooks**
2. Add endpoint: `https://spotless-scrubbers-api.vercel.app/api/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.created`
4. Copy the signing secret (starts with `whsec_`)

**Settings:**
| Setting | Value |
|---------|-------|
| `ENABLE_STRIPE_TEST_CHARGES` | `true` for testing, `false` for production |
| `STRIPE_TEST_CHARGE_CENTS` | `50` (amount in cents for test charges) |

**How it Operates:**
- Creates payment links for deposits
- Processes checkout sessions
- On payment success: creates official job, triggers cleaner assignment
- Sends payment confirmation SMS

---

### 5. GoHighLevel (GHL)

**Purpose:** Lead capture and CRM integration.

**Where to Get Keys:**
1. Log in to [GoHighLevel](https://app.gohighlevel.com)
2. Go to **Settings** → **Integrations**

**Required Values:**
| Field | Where to Find |
|-------|---------------|
| `ghl_location_id` | Settings → Business Info → Location ID |
| `ghl_webhook_secret` | Automations → Webhooks → Secret (if using signatures) |

**Webhook Setup:**
1. Go to **Automations** → **Workflows**
2. Create a trigger for new contacts
3. Add webhook action: `https://spotless-scrubbers-api.vercel.app/api/webhooks/ghl`

**How it Operates:**
- Receives new lead notifications
- Creates leads in local database
- Triggers follow-up automation
- Syncs with HCP if enabled

---

### 6. Telegram

**Purpose:** Cleaner notifications and job assignments.

**Where to Get Keys:**
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Create a new bot with `/newbot`
3. Copy the bot token

**Required Values:**
| Field | Where to Find |
|-------|---------------|
| `telegram_bot_token` | BotFather → Create bot → Copy token |
| `owner_telegram_chat_id` | Message your bot, then check API for chat ID |

**Get Chat ID:**
1. Message your bot on Telegram
2. Visit: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Find `"chat":{"id":XXXXXXXX}` in the response

**Webhook Setup:**
Set webhook with:
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://spotless-scrubbers-api.vercel.app/api/webhooks/telegram"
```

**How it Operates:**
- Sends job assignment requests to cleaners
- Cleaners respond with inline buttons (Accept/Decline)
- On accept: confirms assignment, notifies customer
- On decline: assigns to next available cleaner
- Sends daily schedules and reminders

---

### 7. Wave Invoicing

**Purpose:** Professional invoice generation and tracking.

**Where to Get Keys:**
1. Log in to [Wave](https://www.waveapps.com)
2. Go to **Settings** → **Integrations** → **API**

**Required Values:**
| Field | Where to Find |
|-------|---------------|
| `wave_api_token` | Integrations → API Access → Generate Token |
| `wave_business_id` | Settings → Business Info → ID (or from API) |
| `wave_income_account_id` | Chart of Accounts → Income account ID |

**How to Get Business/Account IDs:**
Use Wave GraphQL API:
```graphql
query {
  businesses {
    edges {
      node {
        id
        name
        accounts {
          edges {
            node {
              id
              name
              type { name }
            }
          }
        }
      }
    }
  }
}
```

**How it Operates:**
- Creates professional invoices for jobs
- Syncs payment status
- Links invoices to customers

---

## Workflow Configuration

The `workflow_config` JSON field in the tenants table controls automation behavior:

```json
{
  "use_housecall_pro": true,      // Enable HCP integration
  "use_vapi_inbound": true,       // Enable inbound AI calls
  "use_vapi_outbound": true,      // Enable outbound AI calls
  "use_ghl": true,                // Enable GHL integration
  "use_stripe": true,             // Enable Stripe payments
  "use_wave": true,               // Enable Wave invoicing

  "lead_followup_enabled": true,  // Enable lead follow-up sequence
  "lead_followup_stages": 5,      // Number of follow-up stages
  "skip_calls_for_sms_leads": true, // Skip calls if lead came via SMS
  "followup_delays_minutes": [0, 10, 15, 20, 30], // Delay between stages

  "post_cleaning_followup_enabled": true,  // Post-job follow-up
  "post_cleaning_delay_hours": 2,          // Hours after completion

  "monthly_followup_enabled": true,        // Monthly re-engagement
  "monthly_followup_days": 30,             // Days since last service
  "monthly_followup_discount": "15%",      // Discount offered

  "cleaner_assignment_auto": true,         // Auto-assign cleaners
  "require_deposit": true,                 // Require deposit for booking
  "deposit_percentage": 50                 // Deposit percentage
}
```

---

## Quick Setup Checklist

### For a New Tenant

1. **Database:** Run `scripts/03-seed-winbros.sql` (or create new seed file)
2. **OpenPhone:** Set up phone number and webhook
3. **VAPI:** Create assistant and configure webhook
4. **HousecallPro:** Get API keys and configure webhooks
5. **Stripe:** Create account, get keys, set up webhook
6. **Telegram:** Create bot, get token, set webhook
7. **Test:** Send test SMS, make test call, verify webhooks

### Webhook URLs Summary

| Service | URL |
|---------|-----|
| OpenPhone | `https://spotless-scrubbers-api.vercel.app/api/webhooks/openphone` |
| VAPI | `https://spotless-scrubbers-api.vercel.app/api/webhooks/vapi` |
| HousecallPro | `https://spotless-scrubbers-api.vercel.app/api/webhooks/housecall-pro` |
| Stripe | `https://spotless-scrubbers-api.vercel.app/api/webhooks/stripe` |
| GoHighLevel | `https://spotless-scrubbers-api.vercel.app/api/webhooks/ghl` |
| Telegram | `https://spotless-scrubbers-api.vercel.app/api/webhooks/telegram` |

---

## Troubleshooting

### Webhook Not Receiving Events
1. Check the webhook URL is correct and accessible
2. Verify the signing secret matches
3. Check Vercel logs for errors
4. Ensure the service is sending to the correct endpoint

### API Key Not Working
1. Verify the key is for the correct environment (live vs test)
2. Check the key hasn't been rotated
3. Verify the key has the required permissions

### Cron Jobs Not Running
1. Check `vercel.json` has correct cron configuration
2. Verify `CRON_SECRET` is set in Vercel environment
3. Check Vercel dashboard for cron execution logs

---

## Important Notes on API Key Storage

### Database vs Environment Variables

The system is designed for **multi-tenant** operation. API keys are stored in TWO places:

1. **Database (`tenants` table)** - Per-tenant keys, used for production
2. **Environment Variables (`.env.local`)** - Fallback/legacy support

**Priority Order:**
1. Per-tenant keys from database (if tenant object is passed)
2. Environment variables (fallback for legacy code)

**Current Configuration:**

| Service | Database Token | Env Var | Notes |
|---------|---------------|---------|-------|
| Telegram | `8239296828:AAH...` | `8586633109:AAF...` | Different bots - DB is primary |
| OpenPhone | Matches | Matches | Consistent |
| VAPI | Matches | Matches | Consistent |
| HousecallPro | Matches | Matches | Consistent |
| Stripe | Matches | Matches | Consistent |
| Wave | Matches | Matches | Consistent |

**Recommendation:** Keep database as source of truth. Env vars are for local development fallback only.

---

## Security Notes

1. **Never commit API keys to git** - Use environment variables
2. **Rotate keys periodically** - Especially after team changes
3. **Use webhook signatures** - Validate all incoming webhooks
4. **Restrict API permissions** - Only grant necessary access
5. **Monitor usage** - Set up alerts for unusual activity
