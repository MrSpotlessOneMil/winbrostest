# Osiris — Claude Instructions

## Working Style
- Prioritize speed and efficiency
- Act as a product co-founder, challenge my assumptions
- Ask clarifying questions about intent, scope, edge cases, and constraints
- Do not assume requirements — surface ambiguity and let me decide
- Always take into account the severity/utility of task, alignment with product goals, potential for bugs/problems, and difficulty to reliably and realistically verify the solution before making decisions
- Respond in a short concise format to optimize directness and speed

## Making Code Changes
- Confirm the approach before writing
- Prioritize future reliability, and scaling (client scaling, feature scaling, etc)
- Always verify edits made to ensure reliability, eliminate potential bug introductions


## Project Context

**Osiris** is a multi-tenant SaaS platform that automates operations for service businesses (window cleaning, house cleaning). Built with Next.js (App Router) on Vercel, Supabase (Postgres + RLS), and Stripe. Current tenants: **WinBros** (window/gutter cleaning), **Cedar Rapids**, **Spotless Scrubbers** (house cleaning).

### What the Product Does
1. **Lead intake** from multiple channels (VAPI phone calls, OpenPhone SMS, HouseCall Pro, GoHighLevel, Meta ads, website)
2. **AI-powered lead qualification** and auto-response (Claude + OpenAI)
3. **Job scheduling** with calendar UI (FullCalendar, drag-and-drop)
4. **Cleaner dispatch** via Telegram bot (accept/decline flow, route optimization)
5. **Payment collection** via Stripe (deposit → job → final payment, auto-retry failed payments)
6. **Customer lifecycle automation** (review requests, monthly re-engagement, seasonal campaigns, frequency nudges)
7. **Operations dashboard** with analytics, team management, earnings, lead funnel, and exception tracking

### Tech Stack
- **Framework:** Next.js 16 (App Router), TypeScript, Tailwind CSS, Shadcn/ui
- **Database:** Supabase (Postgres with RLS enforced via signed HS256 JWTs)
- **Payments:** Stripe (payment intents, payment links, webhooks)
- **Communications:** OpenPhone (SMS), Telegram (cleaner dispatch), Gmail (email)
- **Voice AI:** VAPI (inbound call answering, outbound booking)
- **Integrations:** HouseCall Pro (job mirror), GoHighLevel (CRM), HubSpot, Google Maps
- **Deployment:** Vercel (11 cron jobs, ~80 API routes)
- **Testing:** Vitest

### Architecture Patterns
- **Supabase clients:** `getSupabaseClient()` = anon/RLS, `getSupabaseServiceClient()` = service role (crons/webhooks), `getTenantScopedClient(tenantId)` = custom JWT for dashboard reads
- **Auth:** Session-based (`requireAuthWithTenant()` for dashboard actions, `requireAdmin()` for admin routes, CRON_SECRET for crons)
- **Multi-tenancy:** RLS on all tables via `tenant_id` claim in JWT. Each tenant has own API keys, workflow config (feature flags), and webhook endpoints (`/api/webhooks/{type}/{slug}`)
- **Cron locking:** Postgres RPC functions with `SELECT FOR UPDATE SKIP LOCKED` prevent race conditions
- **Webhook idempotency:** `stripe_processed_events` table + dedup checks
- **Dual-caller routes:** Core logic extracted into functions (e.g. `executeCompleteJob()`) — POST adds tenant check, cron calls directly

### Key Directories
- `app/(dashboard)/` — 14 dashboard pages (overview, customers, jobs, teams, leads, earnings, campaigns, assistant, etc.)
- `app/api/actions/` — 7 dashboard action routes (assign-cleaner, complete-job, retry-payment, send-invoice, send-payment-links, send-sms, sync-hubspot)
- `app/api/cron/` — 13 cron routes (process-scheduled-tasks, send-final-payments, post-job-followup, send-reminders, monthly-followup, etc.)
- `app/api/webhooks/` — 10 webhook routes (stripe, openphone, telegram, vapi, ghl, housecall-pro)
- `app/api/automation/` — 3 automation triggers (job-broadcast, lead-followup, send-reminder)
- `lib/` — 60 utility modules (supabase, auth, tenant, stripe-client, openphone, telegram, vapi, cleaner-assignment, dispatch, pricing, sms-templates, ai-responder, etc.)
- `components/dashboard/` — Dashboard shell, sidebar, stats cards, charts, team status
- `scripts/` — SQL migrations (01-schema through 06-cron-locking)
- `Documentation/` — Master plan, RLS verification docs, change logs

### Database Tables (core)
- `tenants` — Business clients with API keys, workflow_config (feature flags), timezone
- `customers` — End customers with contact info, property details, seasonal tracking
- `jobs` — Full lifecycle (pending → scheduled → in_progress → completed), payment tracking, follow-up flags
- `leads` — Multi-source inbound (new → contacted → qualified → booked → assigned), follow-up stages
- `cleaners` — Field workers with Telegram IDs, availability rules, location
- `cleaner_assignments` — Job↔Cleaner mapping (pending → accepted → confirmed → declined)
- `teams` / `team_members` — Team groupings with roles
- `messages` — All SMS/email/call transcripts
- `calls` — Voice call logs (VAPI transcripts)
- `scheduled_tasks` — Internal task queue (replaces QStash)
- `stripe_processed_events` — Webhook dedup table
- `pricing_tiers` / `pricing_addons` — Per-tenant pricing matrix

### Per-Tenant Workflow Config (feature flags)
Each tenant's `workflow_config` JSONB controls: `use_housecall_pro`, `use_vapi_inbound/outbound`, `use_ghl`, `use_stripe`, `use_cleaner_dispatch`, `use_team_routing`, `use_rainy_day_reschedule`, `use_review_request`, `use_retargeting`, `use_payment_collection`, `lead_followup_enabled`, `require_deposit`, `deposit_percentage`, etc.

### Frontend
- Dark-mode dashboard with sidebar nav, auth context (multi-account switching)
- Public pages: `/login` (neural animated background), `/tip/[jobId]` (Stripe tip collection)
- No Next.js middleware — auth handled at layout/component level via AuthProvider
- State management: React Context (auth only), component-level useState (no Redux/Zustand)

### Pitfalls — Do Not Repeat These
- **Never use `getSupabaseClient()` in crons or webhooks** — anon key has no tenant JWT, RLS silently returns zero rows. Always use `getSupabaseServiceClient()`.
- **Never add `requireAuthWithTenant()` to webhook routes** — webhooks have no user session. They determine tenant from the payload (phone number, slug in URL, Stripe metadata).
- **Variable shadowing in routes that already have `tenant`** — routes like send-invoice and send-payment-links fetch a `tenant` object early. When adding auth, destructure as `authTenant` (e.g. `const { tenant: authTenant } = await requireAuthWithTenant(req)`).
- **`typescript: { ignoreBuildErrors: true }` is set** — TS errors won't block Vercel builds. Don't rely on build failures to catch type issues.
- **Cron routes must verify `CRON_SECRET`** — check `req.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\`` at the top.
- **Always check job/entity status before mutations** — double-execution guards prevent completing an already-completed job or retrying a paid payment. Check status first, act second.
- **Atomic status transitions for Telegram callbacks** — use `UPDATE ... WHERE status='pending'` (not SELECT-then-UPDATE) to prevent TOCTOU races on accept/decline.
- **External API calls need fetch timeouts** — all OpenPhone, Telegram, Google Maps, VAPI, HubSpot calls use 10-15s AbortController timeouts. New integrations must do the same.
- **Cross-tenant validation on all action routes** — every dashboard action must verify `entity.tenant_id === authenticatedTenant.id` before proceeding.
- **New crons that claim rows must use RPC with `FOR UPDATE SKIP LOCKED`** — follow the pattern in `scripts/06-cron-locking.sql`. Don't do SELECT-then-UPDATE in application code.

### Code Conventions
- **API route template:** Export async `GET`/`POST` from `route.ts`, return `NextResponse.json()`. Dashboard actions use `requireAuthWithTenant()`, crons verify `CRON_SECRET`, webhooks use service client.
- **Cron template:** Verify secret → `getSupabaseServiceClient()` → `getAllActiveTenants()` → loop tenants → claim via RPC → process → reset claim on failure.
- **Imports:** Use `@/lib/...` and `@/components/...` path aliases. Named exports preferred.
- **Error responses:** `{ error: string }` with appropriate HTTP status codes. Crons return 200 with summary objects.
- **Tenant feature checks:** `tenantUsesFeature(tenant, 'feature_name')` returns boolean. `tenantHasIntegration(tenant, 'integration')` checks both config flag AND API key presence.
- **SMS sending:** Always go through `sendSMS(tenant, to, message)` from `lib/openphone.ts` — it handles tenant API key resolution and E.164 formatting.

### Current Priorities
<!-- Update this section as focus shifts -->
- Stabilizing WinBros and Cedar Rapids as the primary production tenants
- Security hardening (RLS, auth, cross-tenant isolation) — largely complete
- Reliability (cron locking, idempotency, rate limiting) — largely complete
- Next: onboarding workflow for new tenants