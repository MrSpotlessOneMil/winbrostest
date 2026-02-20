# OSIRIS x WinBros
## Phase 1 – Requirements Gap Analysis & Action Plan

**Agreement Signed:** 1/20/2026
**Target Completion:** ~2/10/2026
**Live Trial:** 2 weeks post-build
**Current Completion:** ~93%
**Last Updated:** 2-19-2026

---

# WHAT'S DONE (~90%)

## Lead & Intake System
- Lead intake from all sources (Meta/GHL, Phone/VAPI, SMS/OpenPhone, HCP webhooks)
- AI call answering + transcript parsing
- Unified lead pipeline with source attribution
- Multi-stage follow-up automation (5 stages)

## Scheduling & Operations
- Calendar-based job scheduling (drag-drop)
- Rain-day rescheduling workflow
- Stripe payment links + post-completion payment trigger
- Telegram cleaner notifications + onboarding
- Multi-tenant architecture

## Performance & Tracking
- Leaderboard
- Earnings tracking
- Tips tracking
- Upsell tracking
- **Equal tip distribution** — `lib/tips.ts` auto-splits tips among assigned cleaners via Stripe webhook
- **Google review $10 attribution** — Team leads confirm via "review job 123" in Telegram

## Lifecycle Messaging (NEW — completed 2-18-2026)
- **Seasonal reminders** — Daily cron sends campaign SMS with dedup, batch limits (50/run), segment-based targeting
- **Service frequency nudges** — Cron nudges customers past configurable window (default 21 days)
- **Review-only follow-up** — Conditional on invoice status; sends review-only template when job has no payment info
- **Seasonal reply tagging** — Detects replies to seasonal SMS within 48h, tags leads as `seasonal_reminder` source
- **Returning customer AI context** — Warm AI prompt for returning customers in both WinBros and house cleaning flows
- **Tenant self-serve campaigns page** — Full UI with toggles, nudge settings, campaign CRUD at `/campaigns`
- **Admin campaigns tab** — Master controls, segment targeting, campaign management
- **SMS templates** — `seasonalReminder()`, `reviewOnlyFollowup()`, `frequencyNudge()` added to `lib/sms-templates.ts`
- **DB migration applied** — `seasonal_reminder_tracker` JSONB on customers, `frequency_nudge_sent_at` on jobs

## Internal Alerts (NEW — completed 2-18-2026)
- **High-value job alerts** — `notifyOwner()` sends Telegram + SMS for $1,000+ jobs
- **Underfilled day alerts** — Wired into alert system via `notifyOwner()`
- **Stacked reschedule alerts** — `checkStackedReschedules()` triggered on HCP job cancellation
- **Daily crew briefing cron** — Weather + schedule + upsell notes sent daily via `crew-briefing/route.ts`, wired into `unified-daily`

## Admin & Infrastructure
- Admin panel with per-tenant controls + credentials
- System event logging / audit trail
- Dead code cleanup — orphaned `post-cleaning-followup` cron removed

## Cron Race Condition Fix (NEW — completed 2-19-2026)
- **Distributed locking via Postgres RPC** — 4 `SELECT FOR UPDATE SKIP LOCKED` functions atomically claim rows, preventing duplicate SMS when Vercel spins up multiple cron instances
- **Migration:** `scripts/06-cron-locking.sql` — `claim_jobs_for_followup`, `claim_jobs_for_monthly_followup`, `claim_jobs_for_monthly_reengagement`, `claim_jobs_for_frequency_nudge`
- **Retry on failure** — If SMS send fails, `sent_at` is reset to NULL so the job retries on the next cron run
- **Crons fixed:** post-job-followup, monthly-followup, monthly-reengagement, frequency-nudge
- **Service client fix** — All 7 cron routes switched from `getSupabaseClient()` (anon key, blocked by RLS) to `getSupabaseServiceClient()` (service role)
- **Column bug fix** — `post-job-followup` referenced `stripe_payment_link` (doesn't exist on jobs table), corrected to `stripe_payment_intent_id`
- **Verified:** RPC functions exist, all 7 crons return 200, concurrent execution test confirms SKIP LOCKED prevents duplicates, retry on SMS failure confirmed

## Security (Completed 2-17 through 2-19)
- **RLS Enforcement** — Tenant isolation enforced at the database level via signed JWTs and Supabase RLS policies (verified 2-19-2026)
- **Demo Seed Auth** — `/api/demo/seed` guarded with `requireAdmin()`, UI hidden for non-admins (verified 2-18-2026)
- **Shared `requireAdmin` utility** — Centralized admin check in `lib/auth.ts`, adopted by all admin routes

## Bug Fixes (Merged from jacks-branch + main, 2-18/2-19)
- Telegram: cleaner lookup fixed when `telegram_id` exists in multiple tenants
- Telegram: new cleaners now show in teams tab after onboarding
- Telegram: onboarding welcome message fixed for WinBros cleaners
- VAPI webhook: uses service role client to bypass RLS (webhooks don't have tenant session)
- WinBros pricing: never uses AI-extracted prices, pricebook only
- Teams: only active `team_members` counted as assigned, inactive shown as unassigned
- Teams: unassigned cleaners now visible, routes for leads only, smoother DnD
- Tenant: inactive tenants can access dashboard
- **Cron service client fix** — All 7 crons were using `getSupabaseClient()` (anon key), silently returning 0 rows after RLS enforcement. Switched to `getSupabaseServiceClient()`
- **post-job-followup column fix** — Referenced `stripe_payment_link` (exists on leads, not jobs). Corrected to `stripe_payment_intent_id`

---

# WHAT'S NOT DONE (~10%)

---

## Reliability
- Weather API returns fake data (crew briefing cron works but uses mock 72F/10% precip)
- Payment retry + card update flow needs verification
- ~~Cron race conditions (no distributed locking)~~ — **DONE** (Postgres RPC + SKIP LOCKED, verified 2-19-2026)
- Debug logging still in production code

## Polish
- Dedicated job/payment exception handling UI (currently partial)
- Normalize `form_data` type inconsistency
- 3-second polling should use Supabase Realtime subscriptions

---

# REQUIREMENT MAPPING (DETAILED)

---

## 1. Lead Intake & Call Handling

| Requirement | Status | Notes |
|-------------|--------|-------|
| AI call answering | Done | VAPI integration |
| Call logging | Done | calls table + Claude parsing |
| Escalation to humans | Done | Telegram alerts |
| Meta leads | Done | GHL webhook |
| Google LSA | Partial | Via HCP only |
| Website forms | Done | GHL + HCP |
| Phone/SMS | Done | OpenPhone + VAPI |
| Unified pipeline | Done | Source attribution present |
| One-time alerts | Done | Scheduled tasks |

---

## 2. Booking Control

| Requirement | Status |
|-------------|--------|
| Client-defined rules | Done |
| Manual override | Done |
| Pricing approval | Done |

---

## 3. Scheduling Safeguards

| Requirement | Status |
|-------------|--------|
| Automated rescheduling | Done |
| Manual override | Done |

---

## 4. Payments

| Requirement | Status |
|-------------|--------|
| Job state tracking | Done |
| Stripe payment trigger | Done |
| Payment retries | Partial |
| Card update flow | Partial |

---

## 5. Lifecycle Messaging

| Requirement | Status | Notes |
|-------------|--------|-------|
| Missed call follow-up | Done | |
| Non-booked follow-ups | Done | |
| Seasonal reminders | Done | Tenant self-serve campaign UI + daily cron |
| Service frequency nudges | Done | Configurable nudge window, daily cron |
| Review follow-ups | Done | |
| Review-only logic | Done | Conditional on invoice status in post-job-followup |
| Seasonal reply warm handling | Done | Tags replies within 48h, warm AI context |

---

## 6. Internal Alerts

| Requirement | Status | Notes |
|-------------|--------|-------|
| High-value alerts | Done | Telegram + SMS via notifyOwner() |
| Underfilled day alerts | Done | Wired into alert system |
| Stacked reschedules | Done | Triggered on HCP job cancellation |
| Daily crew weather briefings | Done | Cron works (uses mock weather data until real API key added) |
| Daily schedule briefing | Done | Included in crew briefing cron |
| Upsell briefing inclusion | Done | Included in crew briefing cron |

---

## 7. Incentive Tracking

| Requirement | Status | Notes |
|-------------|--------|-------|
| Upsells per job/crew | Done | |
| Equal tip distribution | Done | lib/tips.ts auto-splits among assigned cleaners |
| Google review $10 incentive | Done | Telegram "review job 123" command |
| Centralized dashboard | Done | |

---

## 8. Admin Control Panel

| Requirement | Status |
|-------------|--------|
| Rain-day controls | Done |
| Job/payment exceptions | Partial |
| Manual retry tools | Partial |
| Campaign management | Done |

---

## 9. Access & Security

| Requirement | Status | Notes |
|-------------|--------|-------|
| Minimum necessary permissions | Done | RLS enforced via tenant-scoped JWT (fixed 2-19) |
| No password storage | Done | |
| Full audit trail | Done | |
| Access revocation automation | Partial | |
| Demo seed endpoint protection | Done | `requireAdmin()` guard (fixed 2-18) |

---

# PRIORITIZED ACTION ITEMS

---

## Priority 1 — Security (Must Fix Before Trial)

1. ~~**RLS Enforcement Refactor**~~ — **DONE** (verified 2-19-2026)
2. ~~**Demo Seed Authentication**~~ — **DONE** (verified 2-18-2026)

**Status: All Priority 1 items complete.**

---

## Priority 2 — Core Missing Features

3. ~~Daily Crew Briefings~~ — **DONE** (crew-briefing cron + unified-daily)
4. ~~Review-Only Follow-Up Logic~~ — **DONE** (conditional on invoice status)
5. ~~Underfilled Day + Stacked Reschedule Alerts~~ — **DONE** (notifyOwner + HCP cancellation hook)
6. ~~High-Value Job Alerts~~ — **DONE** (Telegram + SMS via notifyOwner)
7. ~~Seasonal Reminders~~ — **DONE** (cron + tenant campaigns UI + admin UI)
8. ~~Service Frequency Nudges~~ — **DONE** (cron + configurable window)
9. ~~Equal Tip Distribution Logic~~ — **DONE** (lib/tips.ts + Stripe webhook)
10. ~~Google Review $10 Attribution~~ — **DONE** (Telegram command)

**Status: All Priority 2 items complete.**

---

## Priority 3 — Reliability & Polish

11. Real Weather API (crew briefing uses mock data)
12. Verify Stripe Retry/Card Update
13. Dedicated Exception Panel
14. Strip Debug Logging
15. Normalize `form_data` Type

---

## Priority 4 — Operational Hardening

16. ~~Fix Cron Race Conditions (`SELECT FOR UPDATE SKIP LOCKED`)~~ — **DONE** (4 RPC functions + service client fix, verified 2-19-2026)
17. Replace 3-Second Polling with Realtime Subscriptions

---

# VERIFICATION PLAN

After completion:

### Lead Flow
- Send test leads from all sources
- Confirm correct source attribution

### Follow-Ups
- Verify 5-stage cascade triggers properly

### Booking
- Create HCP job → verify calendar + Telegram notify

### Payment
- Complete job → verify Stripe link → verify webhook updates

### Review-Only
- ~~Complete job w/o invoice → confirm only review sent~~ — **IMPLEMENTED** (conditional logic in post-job-followup)

### Rain Day
- Trigger reschedule → verify movement + notifications

### Alerts
- ~~Create $1,000 job → verify Telegram alert~~ — **IMPLEMENTED** (notifyOwner sends Telegram + SMS)
- ~~Create underfilled day → verify alert triggers~~ — **IMPLEMENTED**

### Leaderboard
- ~~Verify tips, upsells, review incentives~~ — **IMPLEMENTED** (equal tip split + review attribution)

### Admin
- Retry payment manually
- Mark job complete
- Toggle rain-day controls

### Campaigns
- Verify seasonal reminder cron sends SMS to targeted segments
- Verify frequency nudge respects configurable window
- Verify tenant campaigns page saves/loads correctly

### Cron Race Conditions
- ~~Verify RPC functions exist in Supabase~~ — **VERIFIED** (all 4 `claim_jobs_*` functions present)
- ~~Verify all crons return 200~~ — **VERIFIED** (7/7 crons functional after service client fix)
- ~~Concurrent execution test~~ — **VERIFIED** (Instance A locked row, Instance B got 0 via SKIP LOCKED)
- ~~Retry on SMS failure~~ — **VERIFIED** (`sent_at` reset to NULL on failure, job retries next run)

### Security
- ~~Confirm tenant isolation~~ — **VERIFIED** (RESTRICTIVE policy test, 2-19-2026)
- ~~Verify RLS enforcement after refactor~~ — **VERIFIED** (2-19-2026)
- ~~Verify demo seed auth~~ — **VERIFIED** (live attack simulation, 2-18-2026)

---

# CHANGE LOG

| Date | Change | Details |
|------|--------|---------|
| 2-17-2026 | Demo seed auth fix deployed | `requireAdmin()` added to seed endpoint + admin routes |
| 2-18-2026 | Demo seed auth verified live | Attack simulation confirmed 401 for unauthenticated requests |
| 2-18-2026 | Master plan created | Initial gap analysis at ~70% completion |
| 2-18-2026 | Priority 2 features deployed | Alerts, tips, reviews, crew briefing via DominicsBranch |
| 2-18-2026 | Lifecycle messaging deployed | Seasonal reminders, frequency nudges, review-only, campaigns UI, DB migration |
| 2-18-2026 | Telegram bug fixes merged | Cleaner lookup, onboarding, welcome message fixes via jacks-branch |
| 2-18-2026 | Teams improvements merged | Unassigned cleaners visible, active member counting, smoother DnD |
| 2-18-2026 | Pricing + VAPI fixes | WinBros pricebook-only pricing, VAPI service role fix |
| 2-19-2026 | RLS enforcement deployed & verified | `getTenantScopedClient()` + RLS policies on 16 tables, RESTRICTIVE test passed |
| 2-19-2026 | Inactive tenant fix | Dashboard access allowed for inactive tenants |
| 2-19-2026 | Master plan updated | Completion raised to ~90%, Priority 1 + 2 fully complete |
| 2-19-2026 | Cron service client bug fixed | All 7 crons switched from anon key to service role client — were silently broken since RLS enforcement |
| 2-19-2026 | post-job-followup column fix | `stripe_payment_link` → `stripe_payment_intent_id` (wrong table reference) |
| 2-19-2026 | Cron race condition fix deployed & verified | 4 Postgres RPC functions with `SELECT FOR UPDATE SKIP LOCKED`, concurrent execution test passed, retry on failure confirmed |

---

# Summary

**Current State:** ~93% complete
**Priority 1 (Security):** COMPLETE — RLS enforced, demo seed locked down
**Priority 2 (Contract Features):** COMPLETE — All 8 items delivered
**Priority 4 (Partial):** Cron race conditions FIXED — distributed locking via Postgres RPC verified
**Remaining:** Priority 3 (reliability/polish) + Priority 4 item 17 (realtime subscriptions)
**Before Trial:** Verify Stripe retry flow, add real weather API, strip debug logging
**After Completion:** System ready for controlled 2-week live trial
