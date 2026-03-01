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

**Core flow:** Lead intake (VAPI, OpenPhone, HCP, GHL, Meta, website) → AI qualification → Job scheduling → Cleaner dispatch (Telegram) → Payment (Stripe) → Lifecycle automation

**Stack:** Next.js 16 / TS / Tailwind / Shadcn • Supabase (Postgres + RLS) • Stripe • OpenPhone • Telegram • VAPI • HouseCall Pro • GHL • HubSpot • Google Maps • Vercel (13 crons, ~80 routes) • Vitest

### Architecture
- **Supabase clients:** `getSupabaseClient()` = anon/RLS, `getSupabaseServiceClient()` = service role (crons/webhooks), `getTenantScopedClient(tenantId)` = custom JWT for dashboard reads
- **Auth:** `requireAuthWithTenant()` (dashboard actions), `requireAdmin()` (admin), `CRON_SECRET` bearer (crons)
- **Multi-tenancy:** RLS via `tenant_id` JWT claim. Per-tenant API keys, `workflow_config` JSONB (feature flags), webhook endpoints `/api/webhooks/{type}/{slug}`
- **Cron locking:** Postgres RPC with `SELECT FOR UPDATE SKIP LOCKED` (pattern: `scripts/06-cron-locking.sql`)
- **Idempotency:** `stripe_processed_events` table + dedup at webhook entry
- **Dual-caller routes:** Core logic extracted (e.g. `executeCompleteJob()`) — POST adds auth, cron calls directly

### Pitfalls — Do Not Repeat
Hook-enforced pitfalls (cron secret, service client, fetch timeouts, vercel.json registration) are checked automatically by `.claude/hooks/route-check.sh`. The following require manual vigilance:
- **Variable shadowing** — routes with existing `tenant` var: destructure auth as `authTenant`.
- **`ignoreBuildErrors: true`** — TS errors won't block Vercel builds. Don't rely on build to catch type issues.
- **Check entity status before mutations** — double-execution guards. Check status first, act second.
- **Atomic status transitions** — `UPDATE ... WHERE status='pending'` not SELECT-then-UPDATE (TOCTOU).
- **Cross-tenant validation** — every action route must verify `entity.tenant_id === authenticatedTenant.id`.
- **New tables must have `tenant_id` + RLS** — enable RLS, add `tenant_isolation` policy per `scripts/05-rls-policies.sql`. Composite indexes: `tenant_id` first.

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

### Subagent Policy

#### Auto-trigger (do not skip)
- **security-auditor**: any file in `app/api/actions/`, `app/api/webhooks/`, `app/api/cron/`, `app/api/automation/`, or `lib/auth.ts` modified
- Skip: docs/comments only, purely frontend, or diff under 5 lines with no new files
- After review: log results in `security-auditor.md` (confirmed FAILs → Discovered Bugs, incorrect → False Positives, increment Counter)

#### Manual Review Flow
Triggered on user request (e.g. "review these files"). User is gatekeeper — do not auto-fix.
1. Launch `code-reviewer` + `security-auditor` (if API routes in scope) in parallel, present both reports
2. User picks issues to fix — only fix approved items, only re-review if asked
3. `qa` subagent only if user explicitly requests tests