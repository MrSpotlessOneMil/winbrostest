# Osiris — Claude Instructions

## Working Style
- Act as a product co-founder: challenge assumptions, surface ambiguity, let me decide
- Confirm approach before coding. High-level overviews, not code details. Short plans. Bullet points when possible.

## Project Context

**Osiris** — multi-tenant SaaS automating operations for service businesses (cleaning). Next.js 16 (App Router) on Vercel, Supabase (Postgres + RLS), Stripe. Tenants: WinBros, Cedar Rapids, Spotless Scrubbers.

**Core flow:** Lead intake (VAPI, OpenPhone, HCP, GHL, Meta, website) → AI qualification → Job scheduling (FullCalendar) → Cleaner dispatch (Telegram) → Payment (Stripe deposit→final) → Lifecycle automation (reviews, re-engagement, campaigns)

### Tech Stack
Next.js 16 / TypeScript / Tailwind / Shadcn/ui • Supabase (Postgres + RLS via HS256 JWT) • Stripe • OpenPhone (SMS) • Telegram (dispatch) • VAPI (voice AI) • HouseCall Pro • GoHighLevel • HubSpot • Google Maps • Vercel (13 crons, ~80 routes) • Vitest

### Architecture
- **Supabase clients:** `getSupabaseClient()` = alias for `getSupabaseServiceClient()` (see `lib/supabase.ts:165`), both return service role. `getTenantScopedClient(tenantId)` = anon key + custom HS256 JWT for dashboard reads (RLS enforced)
- **Auth:** `requireAuthWithTenant()` (dashboard actions), `requireAdmin()` (admin), `CRON_SECRET` bearer (crons)
- **Multi-tenancy:** RLS via `tenant_id` JWT claim. Per-tenant API keys, `workflow_config` JSONB (feature flags), webhook endpoints `/api/webhooks/{type}/{slug}`
- **Cron locking:** Postgres RPC with `SELECT FOR UPDATE SKIP LOCKED` (pattern: `scripts/06-cron-locking.sql`)
- **Idempotency:** `stripe_processed_events` table + dedup at webhook entry
- **Dual-caller routes:** Core logic extracted (e.g. `executeCompleteJob()`) — POST adds auth, cron calls directly

### Key Directories
- `app/(dashboard)/` — 14 dashboard pages
- `app/api/actions/` — 7 dashboard action routes
- `app/api/cron/` — 13 cron routes
- `app/api/webhooks/` — 10 webhook routes (stripe, openphone, telegram, vapi, ghl, housecall-pro)
- `app/api/admin/` — ~10 admin routes (tenants CRUD, onboard wizard, connection tests, webhook registration, users)
- `app/api/automation/` — 3 automation triggers
- `lib/` — ~60 utility modules
- `scripts/` — SQL migrations (01-schema through 07-add-gmail-columns)

### Core Tables
- `tenants` — API keys, workflow_config, timezone
- `jobs` — pending → scheduled → in_progress → completed, payment tracking
- `leads` — new → contacted → qualified → booked → assigned
- `customers` — contact info, property, seasonal tracking
- `cleaners` — Telegram IDs, availability, location
- `cleaner_assignments` — pending → accepted → confirmed → declined
- `scheduled_tasks` — internal task queue
- `stripe_processed_events` — webhook dedup

### Key Pitfalls (non-obvious, need narrative)
- **`getSupabaseClient()` = `getSupabaseServiceClient()`** — identical (both service role). Don't flag as bug. Prefer `getSupabaseServiceClient()` in new code for clarity. Real pitfall: never use `getTenantScopedClient()` without a real tenant_id.
- **`ignoreBuildErrors: true`** — TS errors won't block Vercel builds. Don't rely on build to catch type issues.
- **Variable shadowing** — routes with existing `tenant` var: destructure auth as `authTenant`.
- **`getAdminClient()` is dead** — all admin routes now use `getSupabaseServiceClient()`. Don't reintroduce local `createClient` wrappers.

### Pre-Flight Checklist (verify before finishing ANY route)

**All routes:**
- [ ] Correct Supabase client (service for crons/webhooks, scoped for dashboard reads)
- [ ] Auth matches category (actions: `requireAuthWithTenant`, crons: `CRON_SECRET` bearer, webhooks: no user auth, admin: `requireAdmin`)
- [ ] External API calls have AbortController with 10-15s timeout
- [ ] Atomic status transitions: `UPDATE ... WHERE status = 'x'` not SELECT-then-UPDATE
- [ ] Entity status checked before mutations (double-execution guard)
- [ ] `request.json()` wrapped in try-catch (return 400 on malformed body)
- [ ] Error responses: `{ error: string }` with correct HTTP status

**Action routes:**
- [ ] Cross-tenant: `entity.tenant_id === authenticatedTenant.id`, return 404 on mismatch
- [ ] No variable shadowing between entity `tenant` and auth `tenant`

**Cron routes:**
- [ ] Registered in `vercel.json` (missing = silently never runs)
- [ ] Row claiming via RPC with `FOR UPDATE SKIP LOCKED`, receives `p_tenant_id`
- [ ] On failure, claimed row reset to NULL for retry

**Webhook routes:**
- [ ] Tenant resolved from payload (phone lookup, URL slug, Stripe metadata) — NOT user session
- [ ] Tenant resolution uses secret matching, not blind `.find()` on API keys
- [ ] Webhook signature validated where applicable
- [ ] Early-return on tenant resolution failure (no processing without tenant)

**New tables:**
- [ ] `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [ ] RLS enabled + `tenant_isolation` policy per `scripts/05-rls-policies.sql`
- [ ] Composite indexes with `tenant_id` first

**Tests:** 2-3 during implementation. Minimum: happy path, cross-tenant rejection (assert 404), edge case.

### Code Conventions (non-discoverable only)
- **Cron pattern:** Verify secret → service client → `getAllActiveTenants()` → loop → RPC claim → process → reset on failure
- **Feature checks:** `tenantUsesFeature(tenant, 'name')`, `tenantHasIntegration(tenant, 'name')`
- **SMS:** Always via `sendSMS(tenant, to, message)` from `lib/openphone.ts`

### Route Validation Hooks
`.claude/hooks/route-check.sh` auto-runs on Edit/Write to API routes. Checks auth patterns, service client usage, vercel.json registration, AbortController, Stripe idempotency. Blocks with reason on failure. Suppress cron registration check with `// route-check:no-vercel-cron`.

### On-Demand Code Review
User-triggered only. Use Sonnet for high-stakes changes (payments, auth, crons). Don't fix unapproved items. Don't re-run automatically.

### Current Priorities
- All 3 tenants onboarded and live
- Catching bugs with live tenants
- Next: tenant onboarding workflow