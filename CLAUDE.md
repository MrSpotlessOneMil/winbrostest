# Osiris — Claude Instructions

## Working Style
- Prioritize speed and efficiency
- Act as a product co-founder, challenge my assumptions
- Ask clarifying questions about intent, scope, edge cases, and constraints
- Do not assume requirements — surface ambiguity and let me decide
- Always weigh severity/utility, product alignment, bug potential, and verifiability before acting
- Write short, concise, brief plans
- Give me high level overviews, not specific code details

## Making Code Changes
- Confirm the approach before writing
- Prioritize future reliability and scaling
- Always verify edits to ensure reliability, eliminate potential bug introductions

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
- `app/api/automation/` — 3 automation triggers
- `lib/` — ~60 utility modules
- `scripts/` — SQL migrations (01-schema through 06-cron-locking)

### Core Tables
- `tenants` — API keys, workflow_config, timezone
- `jobs` — pending → scheduled → in_progress → completed, payment tracking
- `leads` — new → contacted → qualified → booked → assigned
- `customers` — contact info, property, seasonal tracking
- `cleaners` — Telegram IDs, availability, location
- `cleaner_assignments` — pending → accepted → confirmed → declined
- `scheduled_tasks` — internal task queue
- `stripe_processed_events` — webhook dedup

### Pitfalls — Do Not Repeat
- **`getSupabaseClient()` = `getSupabaseServiceClient()`** — they are identical (both service role). Don't flag `getSupabaseClient()` as a bug. Prefer `getSupabaseServiceClient()` in new server-only code for intent clarity. The real pitfall: never use `getTenantScopedClient()` without a real tenant_id.
- **Never `requireAuthWithTenant()` on webhooks** — no user session. Determine tenant from payload.
- **Variable shadowing** — routes with existing `tenant` var: destructure auth as `authTenant`.
- **`ignoreBuildErrors: true`** — TS errors won't block Vercel builds. Don't rely on build to catch type issues.
- **Crons must verify `CRON_SECRET`** — `req.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\``
- **Check entity status before mutations** — double-execution guards. Check status first, act second.
- **Atomic status transitions** — `UPDATE ... WHERE status='pending'` not SELECT-then-UPDATE (TOCTOU).
- **Fetch timeouts on all external APIs** — 10-15s AbortController (OpenPhone, Telegram, Maps, VAPI, HubSpot, HouseCall Pro).
- **Cross-tenant validation** — every action route must verify `entity.tenant_id === authenticatedTenant.id`.
- **New crons claiming rows** — use RPC with `FOR UPDATE SKIP LOCKED`, not SELECT-then-UPDATE.
- **New cron routes must be registered in `vercel.json`** — missing registration means the cron silently never runs in production.
- **New tables must have `tenant_id` + RLS** — `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, enable RLS, add `tenant_isolation` policy per `scripts/05-rls-policies.sql`. Composite indexes: `tenant_id` first.
- **Webhook tenant resolution must use secret matching** — never `allTenants.find(t => t.api_key)` (picks first blindly). Match by HMAC signature or per-tenant secret comparison.
- **Webhook handlers must early-return on tenant resolution failure** — log + continue without tenant allows unauthenticated processing. Always `return NextResponse.json({ error }, { status: 401 })` on failure.

### Pre-Flight Checklist (verify before finishing ANY route implementation)

**All routes:**
- [ ] Correct Supabase client for route category (service client for crons/webhooks, scoped client for dashboard reads)
- [ ] Auth pattern matches route category (actions: `requireAuthWithTenant`, crons: `verifyCronAuth`, webhooks: no user auth, admin: `requireAdmin`)
- [ ] All external API calls have AbortController with 10-15s timeout
- [ ] Atomic status transitions: `UPDATE ... WHERE status = 'x'` not SELECT-then-UPDATE
- [ ] Entity status checked before mutations (double-execution guard)
- [ ] Error responses use `{ error: string }` with correct HTTP status

**Action routes additionally:**
- [ ] Cross-tenant check: `entity.tenant_id === authenticatedTenant.id`, return 404 on mismatch
- [ ] No variable shadowing between `tenant` from entity lookup and `tenant` from auth

**Cron routes additionally:**
- [ ] Registered in `vercel.json` (silent failure if missing)
- [ ] Row claiming uses RPC with `FOR UPDATE SKIP LOCKED`
- [ ] RPC receives `p_tenant_id` parameter
- [ ] On failure, claimed row reset to NULL for retry

**Webhook routes additionally:**
- [ ] Tenant resolved from payload (phone lookup, URL slug, Stripe metadata) — NOT from user session
- [ ] Webhook signature validated where applicable
- [ ] Early-return on tenant resolution failure (no processing without tenant)

**New tables additionally:**
- [ ] `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [ ] RLS enabled + `tenant_isolation` policy
- [ ] Composite indexes with `tenant_id` first

**Tests:** Write 2-3 route tests during implementation (not after). Minimum: one happy path, one cross-tenant rejection (assert 404), one edge case.

### Code Conventions
- **Routes:** Export async `GET`/`POST` from `route.ts`, return `NextResponse.json()`. Actions use `requireAuthWithTenant()`, crons verify secret, webhooks use service client.
- **Cron pattern:** Verify secret → service client → `getAllActiveTenants()` → loop → RPC claim → process → reset on failure.
- **Imports:** `@/lib/...`, `@/components/...`. Named exports.
- **Errors:** `{ error: string }` with HTTP status. Crons return 200 with summary.
- **Feature checks:** `tenantUsesFeature(tenant, 'name')`, `tenantHasIntegration(tenant, 'name')`.
- **SMS:** Always via `sendSMS(tenant, to, message)` from `lib/openphone.ts`.

### Current Priorities
- All 3 tenants onboarded and live
- Catching problems with live tenants
- Next: tenant onboarding workflow, mobile version

### Route Validation Hooks (deterministic, zero tokens)

`.claude/hooks/route-check.sh` runs automatically on every Edit/Write to API route files. It checks:

**Action routes:** `requireAuthWithTenant` present, `instanceof NextResponse` guard
**Cron routes:** `verifyCronAuth`/`CRON_SECRET` present, service client if direct DB access, registered in `vercel.json`
**Webhook routes:** no `requireAuthWithTenant` (inverse), service client (>30 lines), `stripe_processed_events` for Stripe
**Automation routes:** auth check present
**All routes:** `AbortController` if file uses `fetch()`

Sub-crons called by another cron (not in `vercel.json`) can suppress the registration check with `// route-check:no-vercel-cron`.

The hook blocks with a reason message. Fix the issue, edit again, hook re-runs. No LLM involved.

**Remaining checks that need LLM reasoning** (stay in pre-flight checklist above):
- Cross-tenant data flow correctness (`entity.tenant_id === authenticatedTenant.id`)
- Variable shadowing between `tenant` from entity and `tenant` from auth
- Atomic status transition coverage (`UPDATE WHERE status=`)
- Mass assignment / field allowlisting
- Webhook tenant resolution logic correctness
- RPC `p_tenant_id` parameter passing

### On-Demand Code Review

Triggered when the user explicitly requests a review (e.g. "review these files", "code review for X").

- For **deep logic review** on high-stakes changes (payment flows, auth, new crons): use Sonnet. Do not auto-launch.
- Do NOT fix anything the user didn't approve.
- Do NOT re-run reviewers automatically after fixes — only if user explicitly asks.