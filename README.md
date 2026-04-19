# Osiris Platform

CRM and operations platform for service businesses (house cleaning, window washing). Manages the full lifecycle: lead intake → AI qualification → job scheduling → crew dispatch → payment → lifecycle automation (reviews, re-engagement, campaigns).

## Architecture

Turborepo monorepo with two Next.js 16 apps and shared packages:

```
├── apps/
│   ├── house-cleaning/     → Spotless, Cedar Rapids, West Niagara (port 3001)
│   └── window-washing/     → WinBros (port 3002)
├── packages/
│   ├── core/src/           → Shared business logic (auth, SMS, payments, scheduling)
│   ├── ui/                 → Shared UI components
│   └── types/              → Shared TypeScript types
├── scripts/                → SQL migrations (run manually in Supabase SQL editor)
├── tests/                  → Vitest unit/integration + Playwright e2e
└── app/ & lib/             → ⚠️ DEAD CODE — legacy pre-migration, do not edit
```

### Tech Stack

Next.js 16 (App Router) · TypeScript · Tailwind · Shadcn/ui · Supabase (Postgres + RLS) · Stripe · OpenPhone · Telegram · VAPI · HouseCall Pro · GoHighLevel · HubSpot · Google Maps · Vercel · Vitest

### Route Structure (per app)

| Path | Purpose | Auth |
|------|---------|------|
| `app/(dashboard)/` | Dashboard pages | Session cookie |
| `app/api/actions/` | Dashboard mutations | `requireAuthWithTenant()` |
| `app/api/cron/` | Scheduled jobs | `CRON_SECRET` bearer |
| `app/api/webhooks/` | Inbound webhooks (Stripe, OpenPhone, etc.) | Webhook signatures / tenant slug |
| `app/api/admin/` | Admin operations | `requireAdmin()` |
| `app/api/automation/` | Automation triggers | Varies |

### Multi-tenancy

Row-Level Security via `tenant_id` JWT claims. Per-tenant API keys and feature flags stored in `tenants.workflow_config` (JSONB). Tenant resolution in webhooks uses payload data (phone lookup, URL slug, Stripe metadata) — never user sessions.

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Access to the Supabase project (ask a team member)
- Stripe CLI (for webhook testing): `brew install stripe/stripe-cli/stripe`

### Install

```bash
git clone <repo-url> && cd osiris-platform
npm install
```

### Configure Environment

```bash
cp .env.example .env.local
```

Fill in the values — at minimum you need the **Supabase**, **App URLs**, and **Auth/Cron** sections. See `.env.example` for the full list with descriptions. Get credentials from the Supabase dashboard or ask a team member.

### Run Locally

```bash
# Both apps via Turborepo
npx turbo dev

# Or individually
npm run dev --workspace=apps/house-cleaning   # → localhost:3001
npm run dev --workspace=apps/window-washing   # → localhost:3002
```

> **Note:** `npm run dev` at the repo root starts the legacy root app on port 3000 — don't use it.

### Run Tests

```bash
npm test                              # All Vitest tests
npm run test:watch                    # Watch mode
npm run test:cedar                    # Cedar Rapids scenarios
npm run test:sms                      # SMS regression suite

# E2E (Playwright)
PLAYWRIGHT_BASE_URL=http://localhost:3001 npm run test:e2e
npm run test:e2e:ui                   # Interactive UI mode
```

Unit tests use mocked externals — no real API keys needed (see `tests/setup.ts`).

Playwright defaults to `localhost:3000` — set `PLAYWRIGHT_BASE_URL` to target the correct app.

## Environment Variables

See [`.env.example`](.env.example) for the complete list. Quick reference for what's needed at each level:

| Level | Variables |
|-------|-----------|
| **Minimum to boot** | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL` |
| **Payments** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| **SMS** | `OPENPHONE_API_KEY`, `OPENPHONE_PHONE_ID` |
| **AI features** | `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` |
| **Everything else** | VAPI, Telegram, GHL, HCP, HubSpot, Google, Meta, DocuSign, etc. — see `.env.example` |

## Development Workflow

### Core Package Sync (⚠️ Important Gotcha)

Shared code lives in `packages/core/src/`. Each app's `prebuild` script copies core files into `apps/*/lib/` — **but only if the destination file doesn't already exist**. This means:

- **New files** in `packages/core/src/` propagate automatically on next build.
- **Edits to existing core files do NOT propagate** if the app already has a local copy.
- To push a core fix to an app: delete the app's `lib/` copy so the prebuild re-seeds it, or edit the app's `lib/` file directly.

### `tsconfig` Path Resolution (⚠️ Differs Between Apps)

Both apps alias `@/lib/*`, but the resolution order is inverted:

- **house-cleaning:** `packages/core/src/` first, then `./lib/`
- **window-washing:** `./lib/` first, then `packages/core/src/`

This means the same `@/lib/foo` import can resolve to different files depending on which app you're in.

### Stripe Webhook Testing

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

Use the webhook signing secret it prints as `STRIPE_WEBHOOK_SECRET`.

## Deployment

Both apps deploy to **Vercel** under the `mrspotlessonemils-projects` account (Pro plan).

| Project | App |
|---------|-----|
| `osiris-house-cleaning` | `apps/house-cleaning` |
| `osiris-window-washing` | `apps/window-washing` |

- **Push to `main`** deploys both apps automatically.
- The `Test` branch is retired — do not use it.
- Never use the `dominics-projects-2073b92a` Vercel account.
- Cron jobs are registered in each app's `vercel.json`.

## Database

**Supabase (Postgres)** with Row-Level Security. No ORM — data access via `@supabase/supabase-js`.

### Clients

| Client | Use |
|--------|-----|
| `getSupabaseServiceClient()` | Service role, bypasses RLS. Use in crons, webhooks, server actions. |
| `getSupabaseClient()` | Alias for `getSupabaseServiceClient()` (identical). Prefer the explicit name in new code. |
| `getTenantScopedClient(tenantId)` | Anon key + HS256 JWT with `tenant_id` claim. RLS-enforced. Use for dashboard reads. |

### Core Tables

| Table | Purpose | Key Status Flow |
|-------|---------|-----------------|
| `tenants` | API keys, `workflow_config` JSONB, timezone | — |
| `jobs` | Job records with payment tracking | pending → scheduled → in_progress → completed |
| `leads` | Inbound lead funnel | new → contacted → qualified → booked → assigned |
| `customers` | Contact info, property, seasonal tracking | — |
| `cleaners` | Telegram IDs, availability, location | — |
| `cleaner_assignments` | Dispatch acceptance | pending → accepted → confirmed / declined |
| `scheduled_tasks` | Internal async task queue | pending → processing → completed / failed |
| `stripe_processed_events` | Webhook idempotency dedup | — |
| `quotes` / `visits` | WinBros quoting & visit tracking | — |
| `brain_sources` / `brain_chunks` | AI knowledge base (RAG) | — |

### Migrations

SQL files in `scripts/` and `scripts/migrations/`. Run manually in the Supabase SQL editor — there is no automated migration runner. Key files:

- `01-schema.sql` — base schema
- `05-rls-policies.sql` — RLS policy template
- `06-cron-locking.sql` — `SELECT FOR UPDATE SKIP LOCKED` pattern

## Key Integrations

| Service | Purpose | Env Prefix |
|---------|---------|------------|
| **Stripe** | Payments, card-on-file, charge on completion | `STRIPE_*` |
| **OpenPhone** | SMS messaging | `OPENPHONE_*` |
| **VAPI** | Voice AI (inbound/outbound calls) | `VAPI_*` |
| **Telegram** | Cleaner dispatch & control | `TELEGRAM_*` |
| **GoHighLevel** | CRM follow-ups, automations | `GHL_*` |
| **HouseCall Pro** | Job sync, lead import | `HOUSECALL_PRO_*` |
| **HubSpot** | CRM pipeline sync | `HUBSPOT_*` |
| **Google Maps** | Geocoding, address autocomplete | `GOOGLE_MAPS_*` |
| **Meta** | Ad optimization, lead webhooks | `META_*` |
| **Upstash QStash** | Async task queue | `QSTASH_*` |

## Common Pitfalls

- **`ignoreBuildErrors: true`** — Both apps skip TypeScript errors at build time. Don't rely on Vercel builds to catch type issues. Run `tsc --noEmit` locally.
- **Root `app/` and `lib/` are dead code** — Legacy from before the monorepo migration. Don't edit them.
- **`getAdminClient()` is dead** — All admin routes use `getSupabaseServiceClient()`. Don't reintroduce local `createClient` wrappers.
- **Variable shadowing** — Routes with an existing `tenant` variable: destructure auth as `authTenant` to avoid collisions.
- **Cron routes must be in `vercel.json`** — If a cron route isn't registered there, it silently never runs.

## Useful Commands

```bash
npx turbo dev                         # Start both apps
npm test                              # Vitest (all tests)
npm run test:watch                    # Vitest watch mode
npm run test:e2e                      # Playwright e2e
npm run simulate                      # E2E simulation runner
npm run simulate:seed                 # Seed test data only
npm run simulate:cleanup              # Clean up test data
npm run audit                         # Run audit script
npm run smoke                         # Live smoke test
npm run setup-qstash                  # Configure QStash schedules
```
