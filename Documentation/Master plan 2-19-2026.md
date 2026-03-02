# OSIRIS x WinBros — Master Plan

**Last Updated:** 2-26-2026

---

# TO DO

## Reliability
- [ ] Dedicated job/payment exception handling UI
- [ ] Strip debug logging from production code

## Polish
- [ ] Replace 3-second polling with Supabase Realtime subscriptions

## Live Tenants
- [ ] Collect live tenant data

## WinBros — HouseCall Pro Problems

### Customer sync broken on phone/email change — fixed (2-27)
- [x] `customer.created`/`customer.updated` upserted by `tenant_id,phone_number` — phone changes created NEW customer records, job stayed linked to old one
- [x] Fix: Look up by `housecall_pro_customer_id` first, update in-place. Phone-based upsert only for genuinely new customers
- [x] All 3 customer creation paths (`job.created`, `lead.created`, `customer.created`) now store `housecall_pro_customer_id` for future lookups

### Job status sync — fixed (2-27)
- [x] `job.created` failed on every HCP job — insert referenced non-existent `housecall_pro_customer_id` and `brand` columns on `jobs` table
- [x] `job.updated/completed/cancelled/payment.received` all silently matched zero rows — `Number("job_uuid_string")` = NaN, and handlers used wrong column name `hcp_job_id` instead of `housecall_pro_job_id`
- [x] Job ID extraction missed top-level `job` variable — HCP sends job at payload root, handlers only checked `data.job.id`

## Medium Priority Bugs (from Passes 4-6 audit)
- [ ] Weak password validation (4 chars min)
- [ ] No pagination limits on GET /leads, /jobs (`per_page=999999` possible)
- [ ] Stripe webhook returns 200 even on processing failure (Stripe won't retry)
- [ ] No SMS retry logic in OpenPhone client
- [ ] Google Maps geocoding no retry/backoff
- [ ] Seasonal reminders UTC date comparison (off-by-1 for non-UTC tenants)
- [ ] check-timeouts fetches all pending assignments with no LIMIT
- [ ] Error responses may leak DB column names

---

# DONE

## Cross-Tenant Isolation Hardening (2-26)

- [x] **sendSMS tenant REQUIRED** — Removed 2-arg backward-compat pattern that silently fell back to WinBros. Tenant now required across 20+ call sites
- [x] **Stripe tenant-aware** — All Stripe functions accept `stripeSecretKey` param; deposits/card-on-file use correct tenant's Stripe account (was using env default)
- [x] **OpenPhone webhook tenant fallback removed** — No longer falls back to WinBros on unknown numbers; returns early with `TENANT_ROUTING_FAILED` event
- [x] **Stripe redirect URLs** — Use tenant's `website_url` instead of Osiris dashboard URL
- [x] **`getDefaultTenant()` deprecated** — Loud console warnings on any usage; all callers migrated to explicit tenant resolution

## Context-Aware SMS Bot (2-26)

- [x] **Internal number filtering** — Owner, cleaner, and blocklisted phone numbers filtered from auto-responses (messages still stored for dashboard visibility)
- [x] **`loadCustomerContext()`** — Loads active jobs, service history, customer profile, lead record, and lifetime stats before AI responds
- [x] **Adaptive AI behavior** — Existing customers get help with active bookings (not re-qualified), returning customers get welcome-back flow, new leads get standard booking flow
- [x] **Owner escalation** — AI escalates complaints, refunds, and rescheduling requests to tenant owner via SMS

## Dashboard Mobile Responsiveness (2-26)

- [x] **Sidebar → mobile drawer** — Slide-out drawer with hamburger menu on mobile viewports
- [x] **All dashboard pages responsive** — Overview, customers, jobs, teams, leads, earnings, calls pages with `md:` breakpoints
- [x] **Customers page** — Stacks list/detail vertically on mobile with back button
- [x] **Jobs page** — Defaults to list view on mobile with simplified toolbar
- [x] **Viewport fixes** — `100dvh` for proper mobile height, momentum scrolling, no horizontal overflow
- [x] **Touch-friendly** — Text truncation, flex-wrap, responsive search inputs

## Bug Fixes — Passes 4-6 Audit (2-25)

### Critical
- [x] **send-final-payments cron missing** — Was never in `vercel.json`, final payments were not auto-sending. Added `*/15 * * * *` schedule
- [x] **Admin plaintext password fallback** — If `create_user_with_password` RPC failed, password stored unhashed. Removed fallback; now returns 500
- [x] **30s blocking sleep in double_call** — `process-scheduled-tasks` held serverless function for 30s. Replaced with `scheduleTask()` (second call 30s later via cron)
- [x] **send-reminders timezone bug** — 8am daily check was hardcoded Pacific; Chicago tenants got reminders at wrong time. Now per-tenant timezone

### High
- [x] **Telegram decline TOCTOU** — Same race condition as accept (fixed earlier). Now uses atomic `UPDATE WHERE status='pending'`
- [x] **No fetch timeouts** — OpenPhone, Telegram, Google Maps, VAPI, HubSpot fetch calls had no timeout. Added 10-15s `AbortController` timeouts to all
- [x] **OpenPhone content-based dedup** — Dedup by exact content caused 10-20% false duplicates. Now dedup by OpenPhone message ID, fallback to content+60s window
- [x] **HCP 60s dedup window** — HCP retries after 30min bypassed 60s window. Added two-tier: 60s for feedback loops + 24h for HCP `housecall_pro` source retries
- [x] **Tip endpoint public** — No auth, anyone could create Stripe sessions. Added job status validation (must be completed/assigned) + 5 sessions/job/hour rate limit
- [x] **Send-SMS no rate limit** — Authenticated user could spam unlimited SMS. Added 30 msgs/min per tenant rate limit
- [x] **send-reminders double-scheduled** — `vercel.json` hourly cron + `unified-daily` both called it → double SMS. Removed from `unified-daily`
- [x] **monthly-followup RPC no tenant filter** — RPC claimed ALL jobs globally; Tenant B's jobs starved when Tenant A's loop iteration claimed them. DB migration adds `p_tenant_id` param
- [x] **process-scheduled-tasks timeout cascade** — 50-task batch with external API calls per task → Vercel 60s timeout. Reduced to 10 + 45s elapsed time guard
- [x] **unified-daily silent failures** — Sub-cron failures logged but response always `success: true`. Now returns 207 + `success: false` if any fail
- [x] **Pricing route wrong cookie** — Used `'session'` but auth defines `'winbros_session'`. Fixed to use `SESSION_COOKIE_NAME` constant
- [x] **crew-briefing null tenant** — Sent Telegram with global bot token when tenant null (wrong for multi-tenant). Now skips + logs error

### DB Migrations Applied
- `claim_jobs_for_monthly_followup` — Added `p_tenant_id UUID` param + `tenant_id` in RETURNS TABLE

## Security & RLS

- [x] **RLS enforcement** — Tenant isolation via signed HS256 JWTs + RLS policies on 16 tables (`getTenantScopedClient`) (2-19)
- [x] **RLS cron fix** — All 7 crons switched from anon key to `getSupabaseServiceClient()` — were silently returning 0 rows (2-19)
- [x] **RLS cross-tenant action routes** — 10 dashboard routes now verify `job.tenant_id === tenant.id` via `requireAuthWithTenant()` (2-23, verified 2-25)
- [x] **RLS payment routes** — `overrideClient` param added to 5 helper functions; all 8 Stripe webhook handlers patched (2-19)
- [x] **SSE endpoint disabled** — `/api/events` had zero auth, no active consumers (2-23)
- [x] **Demo seed auth** — `/api/demo/seed` guarded with `requireAdmin()`, verified via live attack simulation (2-18)
- [x] **Shared `requireAdmin` utility** — Centralized in `lib/auth.ts`, adopted by all admin routes (2-18)
- [x] **Multi-tenant OpenPhone webhook signature validation** + `maybeSingle()` fix for 406 (2-20)
- [x] **Hardened tenant isolation** — Protective comments + guards across shared files (2-24)

## Cron Race Conditions

- [x] **Distributed locking** — 4 Postgres RPC functions with `SELECT FOR UPDATE SKIP LOCKED` (`scripts/06-cron-locking.sql`) (2-19)
- [x] **Retry on failure** — `sent_at` reset to NULL on SMS failure, retries next run (2-19)
- [x] **Fixed crons:** post-job-followup, monthly-followup, monthly-reengagement, frequency-nudge (2-19)
- [x] **Column bug** — `post-job-followup` referenced `stripe_payment_link` (leads table), corrected to `stripe_payment_intent_id` (2-19)
- [x] **Verified:** RPC existence, all 7 crons 200, concurrent SKIP LOCKED test, retry on failure (2-19)

## Payments & Stripe

- [x] **Payment retry + card update flow** — `payment_intent.payment_failed` webhook handler, `POST /api/actions/retry-payment`, auto-retry cron (up to 3x, 24h apart), SMS templates (`paymentFailed`, `paymentRetry`) (2-19)
- [x] **`executeCompleteJob()` extraction** — Dual-caller pattern: POST handler adds tenant check, cron calls directly (2-23)
- [x] **Multi-tenant Stripe webhook** — Tries env var then per-tenant secrets (2-20)
- [x] **Stripe redirect fixes** — Deposit + final payment redirects now go to OSIRIS (2-24)
- [x] **Pricing fixes** — Oversized home fallback, DB pricing tier resolution, VAPI pricebook lookup (2-24)
- [x] **8 functional tests PASS** end-to-end for payment retry flow (2-19)
- [x] Verify Stripe retry/card-update flow in production — PASS: webhook live, secret correct, handler deployed, no real declines yet (2-25)

## VAPI / AI Call Booking

- [x] Deposit-first flow — send deposit link instead of immediate cleaner dispatch (2-24)
- [x] Cleaner assignment trigger + price lookup fix in VAPI webhook (2-24)
- [x] Estimate scheduler — address from `extracted_info`, pack appointments front-to-back, 3 optimal time options (2-24)
- [x] Booking detection — `structuredData` fallback for outcome (2-24)
- [x] Availability fix — `job_id` type bug, invalid `deleted_at` filter (2-22)
- [x] Choose-team fix — 0 teams returned due to RLS blocking anon key (2-22)
- [x] Date format fix — `parseNaturalDate` normalizes to YYYY-MM-DD (2-21)
- [x] Pressure washing + gutter cleaning support in WinBros booking flow (2-21)
- [x] WinBros salesman/technician split: estimate flow + HCP technician assignment (2-20)
- [x] Service type extraction for move-in/out (2-24)

## Telegram Bot & Cleaner Management

- [x] "done job X" command — skip to final payment + review (2-24)
- [x] Cleaner pay display (40% of job rev) + AI-powered info updates (2-24)
- [x] Broadcast cleaner assignment to all team members (2-24)
- [x] Review + tip SMS sent immediately when cleaner marks job done (2-24)
- [x] Schedule lookup in Telegram bot (2-21)
- [x] Structured availability collection + home address in onboarding (2-21)
- [x] Slug-based Telegram webhook routing for multi-tenant (2-20)
- [x] Ignore deleted cleaners on registration check (2-21)
- [x] Fix cleaner showing in multiple teams (stale duplicate rows) (2-20)

## HouseCall Pro Integration

- [x] Full job sync: create Lead + Customer + Job, corrections back to HCP (2-21)
- [x] Fix feedback loop — `lead.created` no longer overwrites OSIRIS data (2-24)
- [x] Auth: Token (not Bearer), create customer before lead, 401/403 retries (2-21)
- [x] Fix invalid `lead_source` field causing 400 errors (2-21)
- [x] Price units in cents, timezone offset, `scheduled_end`, full notes (2-21)
- [x] `syncCustomerToHCP` helper — name changes propagate (2-21)
- [x] Official schedule, dispatch, and address APIs (2-21)
- [x] Deprecated Haiku model fix (404) + PATCH→PUT for updates (2-22)

## Multi-Tenant Fixes

- [x] Cross-tenant SMS contamination — lead follow-ups from wrong tenant (2-22)
- [x] Stripe redirects, cron isolation, tip links contamination (2-22)
- [x] Cross-tenant routing — Stripe, Telegram, template bugs (2-22)
- [x] Double assignment, cross-tenant cleaners, pending check (2-22)
- [x] `GHLLead` and `Cleaner` interfaces — Added `tenant_id` field (DB columns existed, accessed via casts) (2-25)
- [x] Cedar Rapids tenant setup via 6 assistant tools (2-20)
- [x] Tenant DB business name in all customer-facing messages (2-21)
- [x] `isWinBrosTenant` → `isWindowCleaningTenant` abstraction (2-22)

## Owner Notifications — Telegram to SMS (2-20)

- [x] All 8 owner notifications converted from `sendTelegramMessage` to `sendSMS` via OpenPhone
- [x] HTML→plain text formatting, guard changed to `tenant.owner_phone`
- [x] Merge regression in `stripe/route.ts` caught + fixed, post-fix audit confirmed

## Multi-Cleaner Job Support (2-24)

- [x] Multi-cleaner jobs + remove cleaner phone from customer SMS

## Dashboard & UI

- [x] Customer delete — admin auth, FK cleanup, polling race condition fix (2-24)
- [x] Customer name update — conversation history truncation fix (2-24)
- [x] Notes display + lead pipeline stage sync (2-24)
- [x] Delete customer button, copy transcript button (2-22)
- [x] Copy Recent Logs button on Debug page + `SYSTEM_RESET` logging (2-22)
- [x] Copy Chat button on Assistant header (2-22)
- [x] Lead card timer fixes — disappearing on reply, loading timer removal (2-21)
- [x] Persist selected customer + Teams filter via localStorage (2-21)
- [x] Role toggle (Technician/Salesman) in team edit modal (2-22)
- [x] Drag-and-drop team members between teams (2-22)
- [x] Delete button for cleaners on teams page (2-21)
- [x] Split reset into per-person buttons (2-22)
- [x] Calendar — trash can, cleaner dropdown, viewport fix, AM/PM parsing, admin 403 fix (2-21)
- [x] Admin user support in all dashboard API routes (2-21)

## SMS Bot & Messaging

- [x] 5 critical SMS booking bugs — dedup, template, dispatch, dates, pricing (2-22)
- [x] Dedup guard fix — no longer blocks legitimate replies (2-22)
- [x] Bot referral source — asks instead of assuming 'SMS' (2-22)
- [x] First name only in greetings (2-20)
- [x] Post-job SMS simplified — just payment link + review (2-24)
- [x] WinBros salesman notifications for estimate flow (2-22)

## AI Assistant

- [x] **Multi-tool call fix** — Tool result accumulation bug caused 400 API errors when Claude called 2+ tools in one turn; fixed message structure to one assistant msg + one user msg with all tool_results (2-25)
- [x] **Cross-tenant job query isolation** — Added `tenant_id` filter to `lookup_customer`, `generate_stripe_link`, `create_wave_invoice` job queries (were leaking jobs across tenants) (2-25)
- [x] **search_customers lead query guard** — Lead query now guards against undefined `tenantId` instead of passing it raw to `.eq()` (2-25)
- [x] **handleDeleteConversation React fix** — Moved side effects out of `setConversations` updater to prevent nested state updates (2-25)
- [x] **Anti-hallucination guards** — CRITICAL RULES in system prompt + assign_cleaner tool description requires customer lookup before using job IDs (2-25)
- [x] **cleanerAssigned() SMS fix** — Removed extra `cleaner.phone` arg that shifted date/time params (sent phone as date) (2-25)
- [x] **assign_cleaner status fix** — Changed from `confirmed` to `pending` so cleaners can accept via Telegram buttons (2-25)
- [x] **Duplicate assignment prevention** — Dedup check before creating assignment in `assign_cleaner` tool (2-25)
- [x] **Telegram accept handler fixes** — `updateJob` + `getCustomerByPhone` switched to service client (RLS was blocking anon key); `customerNotified` variable scoping fix (2-25)
- [x] **`jobs_status_check` constraint fix** — Accept handler set `status: 'assigned'` but CHECK constraint only allows pending/scheduled/in_progress/completed/cancelled; changed to `scheduled` (2-25)
- [x] Model upgraded to Claude Opus 4.6 (2-24)
- [x] Tenant-aware language + reset actually deletes data (2-22)

## Route Optimization

- [x] Real-time re-optimization on payment + 5pm schedule + hourly reminders (2-21)
- [x] End-to-end with timezone-aware dispatch (2-20)
- [x] Status constraint, `MAX_ROUTE_LENGTH`, JSON address fixes (2-21)
- [x] Nominatim + Haversine fallback when no Google Maps API key (2-21)
- [x] Removed 3 AM job-shifting cron, protect `scheduled_at` from overwrite (2-21)
- [x] Exclude completed jobs from cleaner availability check (2-24)

## Lifecycle Messaging (2-18)

- [x] Seasonal reminders — daily cron, dedup, batch limits (50/run), segment targeting
- [x] Service frequency nudges — configurable window (default 21 days)
- [x] Review-only follow-up — conditional on invoice status
- [x] Seasonal reply tagging — 48h window, `seasonal_reminder` source
- [x] Returning customer AI context — warm prompts in both flows
- [x] Tenant self-serve campaigns page + admin campaigns tab
- [x] SMS templates: `seasonalReminder()`, `reviewOnlyFollowup()`, `frequencyNudge()`
- [x] DB migration: `seasonal_reminder_tracker` JSONB, `frequency_nudge_sent_at`

## Internal Alerts (2-18)

- [x] High-value job alerts ($1,000+) via `notifyOwner()` — Telegram + SMS
- [x] Underfilled day alerts
- [x] Stacked reschedule alerts on HCP job cancellation
- [x] Daily crew briefing cron — schedule + upsell notes

## Lead & Intake

- [x] All sources: Meta/GHL, Phone/VAPI, SMS/OpenPhone, HCP webhooks
- [x] AI call answering + transcript parsing
- [x] Unified pipeline with source attribution
- [x] Multi-stage follow-up automation (5 stages)

## Build & Infrastructure

- [x] Vercel build failure — top-level `createClient()` in `winbros-alerts.ts` + `crew-performance.ts` → lazy singleton → consolidated to `getSupabaseServiceClient()` (2-19)
- [x] Standalone client consolidation — 20 call sites across 2 files replaced (2-19)
- [x] `crew-performance.ts` runtime bug — 5 functions referenced dead `supabase` variable (2-19)
- [x] Cedar Rapids test suite — 92 tests (2-22)
- [x] E2E test plan created — 130 items across 3 testers (2-22)

## Testing

- [x] 92 Cedar Rapids integration tests
- [x] 8 payment retry functional tests
- [x] Concurrent cron execution test (SKIP LOCKED)
- [x] Live RLS attack simulation (demo seed)
- [x] 15 RLS cleanup verification tests