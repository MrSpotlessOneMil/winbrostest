# Multi-Tenant Lead Automation Platform - Setup Guide

This guide walks you through setting up the multi-tenant cleaning business automation platform.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Database Setup](#step-1-database-setup)
4. [Step 2: Seed WinBros Tenant](#step-2-seed-winbros-tenant)
5. [Step 3: Add Cleaners](#step-3-add-cleaners)
6. [Step 4: Environment Variables](#step-4-environment-variables)
7. [Step 5: Deploy to Vercel](#step-5-deploy-to-vercel)
8. [Step 6: Configure Webhooks](#step-6-configure-webhooks)
9. [Step 7: Testing](#step-7-testing)
10. [Cron Jobs](#cron-jobs)
11. [Adding New Tenants](#adding-new-tenants)
12. [Troubleshooting](#troubleshooting)

---

## Overview

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Platform                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│   │   WinBros   │    │  Client B   │    │  Client C   │       │
│   │   /winbros  │    │  /clientb   │    │  /clientc   │       │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘       │
│          │                  │                  │               │
│          └──────────────────┼──────────────────┘               │
│                             │                                   │
│                    ┌────────▼────────┐                         │
│                    │  tenants table  │                         │
│                    │  (API keys,     │                         │
│                    │   workflow      │                         │
│                    │   config)       │                         │
│                    └─────────────────┘                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Webhook URL Pattern

Each tenant gets their own webhook URLs:

```
https://your-domain.vercel.app/api/webhooks/{type}/{tenant-slug}

Examples for WinBros (slug: "winbros"):
- VAPI:          /api/webhooks/vapi/winbros
- HousecallPro:  /api/webhooks/housecall-pro/winbros
- Stripe:        /api/webhooks/stripe/winbros
- GHL:           /api/webhooks/ghl/winbros
- OpenPhone:     /api/webhooks/openphone/winbros
- Telegram:      /api/webhooks/telegram/winbros
```

---

## Prerequisites

Before starting, ensure you have:

- [ ] Supabase project set up
- [ ] Vercel account for deployment (Pro plan recommended for all cron jobs)
- [ ] Access to all API dashboards (OpenPhone, VAPI, Stripe, etc.)

---

## Step 1: Database Setup

**WARNING:** This will drop all existing tables and data!

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Open the file `scripts/01-schema.sql`
4. Copy the entire contents
5. Paste into Supabase SQL Editor
6. Click **Run**

This creates all tables including:
- `tenants` - Core multi-tenancy configuration
- `users` & `sessions` - Dashboard authentication
- `cleaners` - With team lead support (`is_team_lead`)
- `customers`, `jobs`, `leads`, `messages`, `calls`
- `teams` & `team_members`
- `tips` & `upsells`
- `cleaner_assignments`
- `system_events`
- `scheduled_tasks` - For database-backed task scheduling

**No additional database scripts needed for cron jobs** - the `scheduled_tasks` table is included in the main schema.

---

## Step 2: Seed WinBros Tenant

1. In Supabase SQL Editor, open `scripts/03-seed-winbros.sql`
2. Review the values (pre-filled with WinBros API keys)
3. Run the script

This creates:
- WinBros tenant with all API keys configured
- Dashboard user (email: `jaspergrenager@gmail.com`, password: `test`)

**Verify it worked:**
```sql
SELECT id, name, slug, email, active FROM tenants WHERE slug = 'winbros';
```

---

## Step 3: Add Cleaners

1. In Supabase SQL Editor, open `scripts/04-seed-winbros-cleaners.sql`
2. Run the script

This creates:
- "Main Team" for WinBros
- Delbert Tran as a team lead
- Team membership assignment

**Verify cleaners:**
```sql
SELECT c.name, c.is_team_lead, t.name as team_name
FROM cleaners c
JOIN tenants tn ON tn.id = c.tenant_id
LEFT JOIN team_members tm ON tm.cleaner_id = c.id
LEFT JOIN teams t ON t.id = tm.team_id
WHERE tn.slug = 'winbros';
```

---

## Step 4: Environment Variables

Your `.env.local` should contain only **universal** keys (shared across all tenants):

```bash
# ============================================================================
# UNIVERSAL ENVIRONMENT VARIABLES
# ============================================================================

# Admin
ADMIN_EMAIL="jaspergrenager@gmail.com"

# AI APIs (shared across all tenants)
ANTHROPIC_API_KEY="sk-ant-..."
OPENAI_API_KEY="sk-proj-..."

# Supabase (shared - one database for all tenants)
NEXT_PUBLIC_SUPABASE_URL="https://kcmbwstjmdrjkhxhkkjt.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGci..."

# Cron Security (for Vercel Cron jobs)
CRON_SECRET="your-secret-here"  # Generate with: openssl rand -hex 32

# Gmail (shared for system emails)
GMAIL_USER="jackdeanmail@gmail.com"
GMAIL_APP_PASSWORD="fhat cifw rgha gity"

# App URL
NEXT_PUBLIC_DOMAIN="https://spotless-scrubbers-api.vercel.app"
```

**Tenant-specific keys are stored in the database** (in the `tenants` table).

---

## Step 5: Deploy to Vercel

```bash
git add -A
git commit -m "Setup multi-tenant platform"
git push
```

Vercel will auto-deploy and configure cron jobs from `vercel.json`.

---

## Step 6: Configure Webhooks

Update webhook URLs in each external service:

### VAPI Dashboard
- URL: `https://spotless-scrubbers-api.vercel.app/api/webhooks/vapi/winbros`

### HousecallPro
- URL: `https://spotless-scrubbers-api.vercel.app/api/webhooks/housecall-pro/winbros`
- Events: customer.created, job.created, job.updated, job.completed, job.cancelled, lead.created, lead.updated, invoice.paid

### Stripe Dashboard
- URL: `https://spotless-scrubbers-api.vercel.app/api/webhooks/stripe/winbros`
- Events: `checkout.session.completed`, `payment_intent.succeeded`

### GoHighLevel
- URL: `https://spotless-scrubbers-api.vercel.app/api/webhooks/ghl/winbros`

### OpenPhone
- URL: `https://spotless-scrubbers-api.vercel.app/api/webhooks/openphone/winbros`

### Telegram Bot
```bash
curl "https://api.telegram.org/bot8239296828:AAH4AO9rzb26ByGg0jfTlWL6F3efli7WKqQ/setWebhook?url=https://spotless-scrubbers-api.vercel.app/api/webhooks/telegram/winbros"
```

---

## Cron Jobs

### How It Works

The platform uses **Vercel Cron** - no additional database setup required!

When you deploy to Vercel, cron jobs are automatically configured via `vercel.json`:

| Job | Schedule | Description |
|-----|----------|-------------|
| `process-scheduled-tasks` | Every minute | Executes delayed tasks from the `scheduled_tasks` table |
| `ghl-followups` | Every 2 minutes | Processes GHL lead follow-up sequences |
| `check-timeouts` | Every 5 minutes | Handles cleaner acceptance timeouts |
| `post-job-followup` | Every 15 minutes | Sends review + recurring + tip after job completion |
| `seasonal-reminders` | Daily at 10am PST | Sends seasonal campaign SMS to targeted customers |
| `frequency-nudge` | Daily at 10:30am PST | Nudges customers due for repeat service |
| `unified-daily` | Daily at 7am PST | Consolidates daily maintenance jobs |
| `send-reminders` | Daily at 8am PST | Customer and cleaner reminders |
| `monthly-followup` | Daily at 10am PST | Re-engagement for past customers |

### Database Scheduler

For delayed tasks (like lead follow-up sequences), tasks are stored in the `scheduled_tasks` table and processed by `process-scheduled-tasks` every minute.

**No separate SQL script needed** - the table is created by `01-schema.sql`.

### Vercel Plan Requirements

- **Hobby Plan**: Limited to 2 cron jobs
- **Pro Plan**: Supports all 7 cron jobs (recommended)

---

## Step 7: Testing

### Test Tenant Lookup
```sql
SELECT * FROM get_tenant_by_slug('winbros');
```

### Test Dashboard Login
1. Go to your app URL
2. Login with: `jaspergrenager@gmail.com` / `test`
3. Verify teams and cleaners show up

### Test Telegram Commands
1. Message the bot with `/start`
2. Try `/myid` to get your chat ID
3. Try `/help` for available commands

### Test Cleaner Assignment
1. Create a job in the dashboard
2. Verify Telegram notification sent to cleaner
3. Accept the job and verify customer SMS sent

---

## Adding New Tenants

### SQL Method

1. Copy `scripts/02-seed-tenant-template.sql`
2. Replace all `{{PLACEHOLDER}}` values with actual data
3. Run in Supabase SQL Editor

### Required Information

| Field | Source |
|-------|--------|
| slug | Choose a URL-safe name (lowercase, hyphens) |
| email | Client's login email |
| password | Choose initial password |
| openphone_api_key | OpenPhone Dashboard → Settings → API |
| vapi_api_key | VAPI Dashboard → API Keys |
| stripe_secret_key | Stripe Dashboard → Developers → API Keys |
| telegram_bot_token | BotFather on Telegram |

### Post-Setup

1. Configure webhooks with the new tenant's slug
2. Set Telegram webhook for the new tenant
3. Create cleaners and teams for the tenant

---

## Troubleshooting

### "Tenant not found" errors
```sql
SELECT * FROM tenants WHERE slug = 'winbros' AND active = TRUE;
```

### Cleaners not showing up
```sql
-- Check cleaner has correct tenant_id
SELECT c.*, t.slug
FROM cleaners c
JOIN tenants t ON t.id = c.tenant_id
WHERE c.active = true;

-- Check team membership
SELECT * FROM team_members WHERE is_active = true;
```

### Cron jobs not running
1. Check Vercel dashboard → Functions → Cron
2. Verify `CRON_SECRET` is set in Vercel environment variables
3. Check logs: Vercel Dashboard → Logs

### Telegram notifications not working
1. Verify cleaner has `telegram_id` set
2. Verify tenant has `telegram_bot_token` set
3. Check webhook is configured correctly

---

## Scripts Summary

| Script | Purpose | When to Run |
|--------|---------|-------------|
| `01-schema.sql` | Create all tables (drops existing!) | Fresh setup only |
| `02-seed-tenant-template.sql` | Template for new tenants | Copy & modify for new clients |
| `03-seed-winbros.sql` | Add WinBros tenant + user | After schema |
| `04-seed-winbros-cleaners.sql` | Add WinBros cleaners + team | After tenant |

---

*Last updated: January 2026*
