# 🚀 Osiris Code Overview

A multi-tenant, AI-driven operations system for service businesses.  
Handles lead intake, AI qualification, job scheduling, dispatch, automation, payments, and analytics — all in one platform.

---

# 🧱 Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js (App Router), React 19, TypeScript |
| **Database** | Supabase (PostgreSQL) |
| **UI** | Tailwind CSS 4, Radix UI, shadcn/ui |
| **AI** | Anthropic Claude (primary), OpenAI (fallback) |
| **Voice** | VAPI |
| **SMS** | OpenPhone |
| **Jobs** | HousecallPro |
| **Payments** | Stripe |
| **Notifications** | Telegram |
| **Invoicing** | Wave (optional) |
| **Scheduling** | DB-backed `scheduled_tasks` + Vercel Cron |
| **Hosting** | Vercel |

---

# 🏗️ System Architecture

## 1️⃣ Lead Intake & AI Qualification

**Lead Sources**
- OpenPhone (SMS)
- VAPI (voice calls)
- HousecallPro webhooks
- GoHighLevel CRM
- Manual entry

**Webhook Pattern**
```
/api/webhooks/{source}/{tenant-slug}
```

**AI Processing Pipeline**
- `lib/ai-intent.ts` → Intent detection (Claude)
- `lib/ai-responder.ts` → AI response generation
- `lib/auto-response.ts` → Auto-reply decision logic

**Lead Lifecycle**
```
new → contacted → qualified → booked → assigned → nurturing → lost
```

Stored in `leads` table.

---

## 2️⃣ Job Scheduling & Dispatch

**Sync Source**
- HousecallPro via webhook

**Core Logic**
- `/api/actions/assign-cleaner`
- `lib/cleaner-assignment.ts`
- `lib/route-optimizer.ts`
- `lib/dispatch.ts`

**Dashboard UI**
```
/app/(dashboard)/jobs/page.tsx
```
Drag-and-drop calendar with conflict detection.

---

## 3️⃣ Automation & Follow-Up Engine

**Core Files**
- `lib/scheduler.ts`
- `lib/cascade-scheduler.ts`

**Queue System**
- `scheduled_tasks` table (replaced QStash)

**Cron Execution**
```
/api/cron/process-scheduled-tasks
```
Runs every minute via Vercel Cron.

**Automations**
- Reminders
- Post-job follow-ups
- Re-engagement campaigns
- Payment collection

---

## 4️⃣ Team Management

- Cleaners stored in `cleaners` table
- Team grouping supported
- Telegram job assignment notifications
- Tips and upsells tracked per job

**Leaderboard**
```
/app/(dashboard)/leaderboard/page.tsx
```

---

## 5️⃣ Customer Management

```
/app/(dashboard)/customers/page.tsx
```

Features:
- Full customer timeline
- SMS history
- Call logs
- Jobs
- Lead funnel flow

⚠ Currently polls `/api/customers` every 3 seconds (scaling concern).

---

## 6️⃣ Payments

- Stripe payment links
- Wave invoicing (optional)
- Public tip collection page:
```
/tip/[jobId]
```

---

## 7️⃣ Dashboard & Analytics

```
/app/(dashboard)/page.tsx
```

Includes:
- Revenue chart
- Lead source breakdown
- Today’s jobs
- KPI metrics

**Metrics Endpoint**
```
/api/metrics
```

---

## 8️⃣ Multi-Tenancy

- Each tenant stored in `tenants` table
- Tenant-specific API keys
- All queries filtered by `tenant_id`
- Sidebar account switching supported
- Proper data isolation enforced

---

---

# 📁 Critical Files Reference

| File | Purpose |
|------|----------|
| `lib/live-data.ts` | Dashboard data fetching |
| `lib/scheduler.ts` | Task scheduling engine |
| `lib/ai-intent.ts` | Claude intent detection |
| `lib/auto-response.ts` | Auto-reply logic |
| `lib/dispatch.ts` | Cleaner assignment |
| `app/api/cron/process-scheduled-tasks/route.ts` | Task executor |
| `app/(dashboard)/customers/page.tsx` | Customer management |
| `app/(dashboard)/exceptions/page.tsx` | Demo seeding risk |
| `lib/types.ts` | Shared TypeScript definitions |
| `vercel.json` | Cron configuration |

---

# Checkmark 2-17-2026

# ✅ What’s Fully Built & Working

- AI-powered lead qualification + auto-response
- Multi-tenant architecture with data isolation
- Calendar-based job scheduling with conflict detection
- Unified customer timeline (SMS, calls, jobs, lead flow)
- Smart cleaner dispatch with route optimization
- Database-backed task scheduler (no QStash)
- Stripe payment links
- Telegram cleaner notifications
- Webhook handlers for all integrations
- Event/audit logging via `system_events`
- Multi-account dashboard switching
- Lead-to-booking funnel visualization
- Rain-day rescheduling logic
- Leaderboard and earnings tracking

---

# ⚠️ Risks, Gaps & Technical Debt

## 🔴 CRITICAL

### Demo Seeding UI Exposed in Production
```
app/(dashboard)/exceptions/page.tsx
```
Allows inserting fake data (customers, jobs, leads) into production database.  
**Risk: Data corruption in live environment.**

### `form_data` Type Inconsistency
Database stores `form_data` as:
- JSON string
- OR object

Forces defensive `as any` casting across UI code.

---

## 🟠 HIGH

### Verbose Debug Logging in Production
```
lib/live-data.ts (295–459)
```
Emoji debug logs printing DB queries and connection details.

### Silent API Failures
API routes catch errors and return empty data with no user-facing feedback.

---

## 🟡 MEDIUM

### 3-Second Polling
```
customers/page.tsx:151
```
Should use Supabase real-time subscriptions.

### Cron Race Conditions
No distributed locking on scheduled tasks.  
Multiple Vercel instances can execute the same task twice.

### Weather Fallback Returns Fake Data
```
lib/weather.ts:338
```
Returns mock weather (72°F, 10% precip) silently if weather API is missing.

---

## 🟢 LOW

- Vague commit history ("fix")
- Unsafe `as any` type casting
- SQL scripts contain `{{PLACEHOLDER}}` template values

---

# 🛠️ Priority Roadmap

## Immediate (High Impact)

1. Remove or gate demo seeding UI.
2. Strip debug logs from `lib/live-data.ts`.
3. Normalize `form_data` type at database or API layer.

## Reliability Improvements

1. Replace polling with Supabase real-time subscriptions.
2. Add `locked_at` column for cron task locking.
3. Standardize API error responses with shared handler.

## Architectural Improvements

1. Complete TypeScript definitions in `lib/types.ts`.
2. Integrate real weather API.
3. Remove `as any` patterns.

