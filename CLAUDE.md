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
- **Supabase clients:** `getSupabaseClient()` = anon/RLS, `getSupabaseServiceClient()` = service role (crons/webhooks), `getTenantScopedClient(tenantId)` = custom JWT for dashboard reads
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
- **Never `getSupabaseClient()` in crons/webhooks** — no tenant JWT, RLS returns zero rows silently. Use `getSupabaseServiceClient()`.
- **Never `requireAuthWithTenant()` on webhooks** — no user session. Determine tenant from payload.
- **Variable shadowing** — routes with existing `tenant` var: destructure auth as `authTenant`.
- **`ignoreBuildErrors: true`** — TS errors won't block Vercel builds. Don't rely on build to catch type issues.
- **Crons must verify `CRON_SECRET`** — `req.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\``
- **Check entity status before mutations** — double-execution guards. Check status first, act second.
- **Atomic status transitions** — `UPDATE ... WHERE status='pending'` not SELECT-then-UPDATE (TOCTOU).
- **Fetch timeouts on all external APIs** — 10-15s AbortController (OpenPhone, Telegram, Maps, VAPI, HubSpot).
- **Cross-tenant validation** — every action route must verify `entity.tenant_id === authenticatedTenant.id`.
- **New crons claiming rows** — use RPC with `FOR UPDATE SKIP LOCKED`, not SELECT-then-UPDATE.
- **New cron routes must be registered in `vercel.json`** — missing registration means the cron silently never runs in production.
- **New tables must have `tenant_id` + RLS** — `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, enable RLS, add `tenant_isolation` policy per `scripts/05-rls-policies.sql`. Composite indexes: `tenant_id` first.

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

Skip when:
- Change is documentation/comments only
- Change is purely frontend (`components/`, CSS, no API calls)
- Total diff is under 5 lines AND no new files created

After reviewing security-auditor results, add confirmed FAILs to Discovered Bugs, incorrect FAILs to False Positives, and add 1 to Counter in `security-auditor.md`.
When a new bug class is discovered, update the security-auditor's `.md` checklist before closing the task.

#### Manual Review Flow

Triggered when the user requests a code review (e.g. "review these files", "code review for X"). The user is the gatekeeper at every step — do not auto-fix or auto-iterate.

**Step 1 — Review (parallel)**
- Launch `code-reviewer` (haiku) and `security-auditor` (haiku) in parallel on the target files
- Security-auditor only runs if scope includes API routes — otherwise code-reviewer alone
- Present both reports to the user together

**Step 2 — User decides**
- User picks which issues to fix (typically Critical/High — Medium/Low are suggestions only)
- Do NOT fix anything the user didn't approve
- Do NOT re-run reviewers automatically after fixes — only if user explicitly asks for re-review

**Step 3 — QA (optional, user-requested only)**
- Only run `qa` subagent if the user explicitly asks for it (e.g. "run tests", "QA this")
- QA generates ephemeral tests in `tests/_review/`, runs them, reports results, cleans up
- If tests reveal real bugs: report to user, user decides next steps