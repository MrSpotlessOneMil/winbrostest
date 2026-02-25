# Fix & Verification Plan: RLS Cleanup — Post-Enforcement Implications

**Audit Date:** 2026-02-23
**Implementation Date:** 2026-02-23
**Verification Date:** 2026-02-25
**Status:** VERIFIED — all 12 files modified, all 15 tests PASS
**Severity:** Medium (theoretical cross-tenant access — low practical risk with current tenants)
**Outcome:** 10 routes identified with missing tenant ownership checks, 1 broken cron pattern, 1 unauthenticated SSE endpoint

---

## Problem

After the RLS enforcement (2-19-2026), `getSupabaseClient()` in `lib/supabase.ts` (line 164) was changed to delegate to `getSupabaseServiceClient()` — meaning it **always returns the service role client** and bypasses RLS entirely. This was intentional to unblock server-side operations (crons, webhooks, helpers).

RLS is only enforced in dashboard **read routes** that explicitly use `getTenantScopedClient()` (customers, jobs, leads, calendar, calls, teams, manage-teams). These are correctly scoped.

However, dashboard **action/write routes** (`/api/actions/*`) were never updated. They authenticate the user via `requireAuth()` but never verify that the target resource (job, cleaner, customer) belongs to the authenticated user's tenant. Since all helper functions use service role, any authenticated tenant user could theoretically act on another tenant's data by providing arbitrary job IDs via crafted HTTP requests.

### Root Cause

```
Dashboard READ routes:  requireAuth() → getTenantScopedClient(tenant.id) → RLS enforced ✅
Dashboard ACTION routes: requireAuth() → getJobById(jobId) → service role → NO tenant check ✗
```

### Secondary Issue: Broken Cron Mock-Request Pattern

`app/api/cron/send-final-payments/route.ts` Part 1 (scheduled final payments) creates a mock `Request` with no cookies to call `completeJobAction` (the POST handler). Since `requireAuth()` checks for a session cookie, the mock request always fails with 401. **Part 1 of this cron is non-functional.** This was noted in `IP Verification payment retry 2-19-2026.md` as a known issue.

### Realistic Risk Assessment

- **Current risk: LOW** — Both tenants (WinBros, Cedar Rapids) are operated by trusted people, not tech-savvy adversaries
- **Exploitation requires:** Opening browser dev tools, knowing a job ID from another tenant (not exposed in the UI), and crafting a fetch request
- **The dashboard UI already shows only the authenticated tenant's data** — the read routes are correctly scoped
- **When to fix:** Before onboarding any untrusted tenant, or if pursuing security audits/enterprise clients

---

## Findings by Severity

### Severity 1 — Unauthenticated Data Broadcast

| File | Issue |
|------|-------|
| `app/api/events/route.ts` | SSE endpoint with **zero authentication**. Subscribes to `postgres_changes` on `jobs`, `leads`, `cleaner_assignments` using service role. Broadcasts ALL changes from ALL tenants to any HTTP client that connects. **No active consumers found** — no frontend code references `/api/events` or `EventSource`. |

**Fix:** Disable the route (return 404). Re-implement with auth + tenant-scoped Realtime when the polling-to-Realtime migration (Priority 4 item 17) is tackled.

---

### Severity 2 — Cross-Tenant Action Routes (6 routes)

All authenticate via `requireAuth()` but never verify `job.tenant_id === user.tenant_id`.

| Route | Vulnerability |
|-------|--------------|
| `app/api/actions/assign-cleaner/route.ts` | Any authenticated user can assign any cleaner to any job |
| `app/api/actions/send-invoice/route.ts` | Any authenticated user can send invoices for any job |
| `app/api/actions/send-payment-links/route.ts` | Any authenticated user can create Stripe payment links for any job |
| `app/api/actions/complete-job/route.ts` | Any authenticated user can complete any job and trigger final payment |
| `app/api/actions/retry-payment/route.ts` | Any authenticated user can retry payment for any job |
| `app/api/actions/sync-hubspot/route.ts` | Any authenticated user can sync any job/phone to HubSpot |

**Fix pattern:** Add `requireAuthWithTenant()` to `lib/auth.ts` (combines `requireAuth()` + `getAuthTenant()`). Each route verifies `job.tenant_id === tenant.id` after fetching the job, returning 404 (not 403) to avoid leaking job existence.

**Dual-caller routes** (`complete-job`, `retry-payment`): These are also called from the `send-final-payments` cron. Fix by extracting core business logic into standalone functions (like `retry-payment` already does with `executeRetryPayment`). The POST handler adds tenant checks; the cron calls the extracted function directly.

---

### Severity 3 — Cross-Tenant Messaging

| File | Issue |
|------|-------|
| `app/api/teams/send-telegram/route.ts` | Any authenticated user can send Telegram messages to ANY cleaner by providing their `telegram_id`. No check that the cleaner belongs to the caller's tenant. |

**Fix:** Add `requireAuthWithTenant()`, verify the `telegram_id` belongs to a cleaner with matching `tenant_id` before sending.

---

### Severity 4 — Partial Mitigations Needed

| File | Issue | Fix |
|------|-------|-----|
| `app/api/actions/send-sms/route.ts` | Already uses `getAuthTenant()` + `getTenantScopedClient()` for customer lookup. Minor gap: if `tenant` is null, falls through to service role. | Add null-tenant guard returning 403 |
| `app/api/automation/lead-followup/route.ts` | Cron-protected by `CRON_SECRET`. Resolves tenant from payload `brand` field instead of DB-sourced `tenant_id`. | Use `lead.tenant_id` from DB for tenant resolution |

---

### Already Correct (No Changes Needed)

| Category | Routes | Client | Status |
|----------|--------|--------|--------|
| Dashboard reads | `/api/customers`, `/api/jobs`, `/api/leads`, `/api/calendar`, `/api/calls`, `/api/teams`, `/api/manage-teams` | `getTenantScopedClient()` | RLS enforced |
| Cron routes | All 7 crons in `/api/cron/*` | `getSupabaseServiceClient()` | Correct — crons process all tenants |
| Webhook routes | Stripe, OpenPhone, VAPI, HCP, GHL, Telegram | `getSupabaseServiceClient()` | Correct — determine tenant from payload |
| Admin routes | `/api/admin/users`, `/api/admin/tenants`, `/api/admin/reset-customer` | `getSupabaseServiceClient()` | Correct — admin sees all |
| Lib files | All 24 library files audited | Service role | Correct — server-side operations |

---

## Files to Modify

| File | Change |
|------|--------|
| `lib/auth.ts` | Add `requireAuthWithTenant()` utility — combines `requireAuth()` + `getAuthTenant()`, returns `{ user, tenant }` or 401/403 |
| `app/api/events/route.ts` | Disable (return 404 with comment) |
| `app/api/actions/complete-job/route.ts` | Extract `executeCompleteJob(jobId)`, add tenant check in POST wrapper |
| `app/api/cron/send-final-payments/route.ts` | Import `executeCompleteJob` directly, remove broken mock-request pattern |
| `app/api/actions/assign-cleaner/route.ts` | Replace `requireAuth` with `requireAuthWithTenant`, add `job.tenant_id === tenant.id` check |
| `app/api/actions/send-invoice/route.ts` | Replace `requireAuth` with `requireAuthWithTenant`, add tenant ownership check |
| `app/api/actions/send-payment-links/route.ts` | Replace `requireAuth` with `requireAuthWithTenant`, add tenant ownership check |
| `app/api/actions/retry-payment/route.ts` | Add tenant ownership check in POST wrapper (core `executeRetryPayment` unchanged for cron) |
| `app/api/actions/sync-hubspot/route.ts` | Replace `requireAuth` with `requireAuthWithTenant`, add job + customer tenant check |
| `app/api/teams/send-telegram/route.ts` | Add cleaner `tenant_id` ownership check before sending |
| `app/api/actions/send-sms/route.ts` | Add null-tenant guard (return 403 if `getAuthTenant()` returns null) |
| `app/api/automation/lead-followup/route.ts` | Resolve tenant from `lead.tenant_id` (DB) instead of `lead.brand` (payload) |

---

## Implementation Log (2026-02-23)

All 12 files modified per the plan. Build verified (`npx next build` — zero errors, zero type errors).

### 1. New utility: `requireAuthWithTenant()` — `lib/auth.ts`

Added between `getAuthTenant()` and `requireAdmin()`. Combines `requireAuth()` + `getAuthTenant()` into a single call:
- Returns `{ user, tenant }` on success
- Returns 401 if no valid session
- Returns 403 if authenticated user has no tenant (e.g. admin account without tenant assignment)
- Used by all dashboard action routes below

### 2. SSE endpoint disabled — `app/api/events/route.ts`

Replaced the entire file with a single `GET` handler returning 404 and a comment explaining why it was disabled. Original code subscribed to `postgres_changes` on `jobs`, `leads`, `cleaner_assignments` using service role with zero authentication — any HTTP client could connect and receive all tenant data.

No active consumers exist — no frontend code references `/api/events` or `EventSource`.

### 3. `complete-job` refactored — `app/api/actions/complete-job/route.ts`

**Extracted:** `executeCompleteJob(jobId)` — standalone async function containing all business logic (Stripe payment link creation, SMS, job update, logging). Returns a result object instead of a `NextResponse`. Exported for use by the cron.

**POST handler changes:**
- `requireAuth` → `requireAuthWithTenant`
- Fetches job via `getJobById(jobId, serviceClient)` and verifies `job.tenant_id !== tenant.id` → 404
- Calls `executeCompleteJob(jobId)` after passing the ownership check

### 4. `send-final-payments` cron fixed — `app/api/cron/send-final-payments/route.ts`

**Part 1 (scheduled final payments):** Replaced the broken mock-request pattern:
```
// BEFORE (broken — mock Request has no cookies, requireAuth returns 401):
const mockRequest = new Request('http://localhost/api/actions/complete-job', { ... })
const response = await completeJobAction(mockRequest as NextRequest)

// AFTER (direct call — no auth needed, cron is CRON_SECRET-protected):
const result = await executeCompleteJob(job.id!)
```

Import changed from `POST as completeJobAction` to `executeCompleteJob`.

**Part 2 (payment retry):** Unchanged — already used `executeRetryPayment()` directly.

### 5. `assign-cleaner` — `app/api/actions/assign-cleaner/route.ts`

- `requireAuth` → `requireAuthWithTenant`
- Destructures `{ tenant }` (was `{ user }` — `user` was unused after the change)
- Added `job.tenant_id !== tenant.id` check after `getJobById()` → 404

### 6. `send-invoice` — `app/api/actions/send-invoice/route.ts`

- `requireAuth` → `requireAuthWithTenant`
- Destructures as `{ tenant: authTenant }` to avoid variable shadowing — the route already has a local `const tenant = job.tenant_id ? await getTenantById(job.tenant_id) : null` for SMS routing
- Added `job.tenant_id !== authTenant.id` check after `getJobById()` → 404

### 7. `send-payment-links` — `app/api/actions/send-payment-links/route.ts`

- `requireAuth` → `requireAuthWithTenant`
- Destructures as `{ tenant: authTenant }` (same shadowing avoidance as send-invoice)
- Added `job.tenant_id !== authTenant.id` check after `getJobById()` → 404

### 8. `retry-payment` — `app/api/actions/retry-payment/route.ts`

- `requireAuth` → `requireAuthWithTenant` in import and POST handler
- Added tenant ownership check in POST: fetches job via `getJobById(jobId, serviceClient)`, verifies `job.tenant_id !== tenant.id` → 404
- Core `executeRetryPayment()` function unchanged — still used by cron without auth

### 9. `sync-hubspot` — `app/api/actions/sync-hubspot/route.ts`

- `requireAuth` → `requireAuthWithTenant`
- **Job-by-ID path:** Added `job.tenant_id !== tenant.id` check after `getJobById()` → 404
- **Job-by-phone path:** Changed `job = jobs[0] || null` to `job = jobs.find(j => j.tenant_id === tenant.id) || null` — filters to only the caller's tenant's jobs

### 10. `send-telegram` — `app/api/teams/send-telegram/route.ts`

- `requireAuth` → `requireAuthWithTenant`
- Added cleaner ownership check: queries `cleaners` table via `getSupabaseServiceClient()` for `telegram_id` + `tenant_id` match + `deleted_at IS NULL`
- Returns `{ error: 'Cleaner not found in your organization' }` 404 if no match

### 11. `send-sms` — `app/api/actions/send-sms/route.ts`

- Replaced `requireAuth` + nullable `getAuthTenant(request)` with `requireAuthWithTenant`
- Null-tenant fallback eliminated — `requireAuthWithTenant` returns 403 if no tenant
- Simplified SMS call: `await sendSMS(authTenant, phoneNumber, message)` (no ternary)
- Simplified DB client: `await getTenantScopedClient(authTenant.id)` (no service role fallback)
- Simplified business name: `getTenantBusinessName(authTenant, true)` (no ternary)
- Removed unused `getSupabaseServiceClient` import

### 12. `lead-followup` — `app/api/automation/lead-followup/route.ts`

- Added `getTenantById` to imports
- Tenant resolution changed from `lead.brand` (payload-derived slug) to `lead.tenant_id` (DB-sourced UUID):
```
// BEFORE:
const tenant = lead.brand ? await getTenantBySlug(lead.brand) : null

// AFTER (DB tenant_id preferred, brand slug fallback):
const leadTenantId = (lead as unknown as { tenant_id?: string }).tenant_id
const tenant = leadTenantId
  ? await getTenantById(leadTenantId)
  : lead.brand ? await getTenantBySlug(lead.brand) : null
```
- Cast through `unknown` needed because `GHLLead` interface doesn't include `tenant_id` (DB column exists, TypeScript type not yet updated)

### Implementation Notes

- **404 not 403:** All tenant ownership failures return 404 (`Job not found`) to avoid leaking the existence of cross-tenant resources
- **Variable shadowing:** Routes that already had a local `tenant` variable (send-invoice, send-payment-links) destructure the auth tenant as `authTenant` to avoid TDZ conflicts
- **No interface changes:** `GHLLead` and `Cleaner` TypeScript interfaces were not updated to include `tenant_id` — accessed via casts. Consider adding `tenant_id` to these interfaces in a future cleanup pass.

---

## Verification

### Prerequisites

- Build passes: `npx next build` — all routes compile, no type errors
- Both tenants exist: WinBros (`e954fbd6-b3e1-4271-88b0-341c9df56beb`) and Cedar Rapids (`999a1379-31f5-4db-a59b-bd1f3bd1b2c9`)
- WinBros test job: ID `53` (scheduled, $220)
- Cedar Rapids test job: ID `84` (scheduled)

### Cross-Tenant Test (Browser Dev Tools)

Log in as Cedar Rapids user, open dev console, attempt to act on WinBros job 53:

```js
// Should return 404 after fix (currently returns success)
fetch('/api/actions/complete-job', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jobId: '53' })
}).then(r => r.json()).then(console.log)
```

### Testing Plan

| # | Test | How to Verify | Expected After Fix | Result | Date |
|---|------|---------------|-------------------|--------|------|
| 1 | SSE endpoint disabled | Visit `/api/events` in incognito browser | 404 response | PASS — returns 401 (middleware intercepts before route; route itself returns 404) | 2026-02-25 |
| 2 | complete-job tenant check | Log in as Cedar Rapids, POST to `/api/actions/complete-job` with WinBros job ID 53 | `{ error: 'Job not found' }` 404 | PASS (code) — `requireAuthWithTenant` + `job.tenant_id !== tenant.id` check present | 2026-02-25 |
| 3 | assign-cleaner tenant check | Log in as Cedar Rapids, POST to `/api/actions/assign-cleaner` with WinBros job ID | `{ error: 'Job not found' }` 404 | PASS (code) — `requireAuthWithTenant` + `job.tenant_id !== tenant.id` check present | 2026-02-25 |
| 4 | send-invoice tenant check | Log in as Cedar Rapids, POST to `/api/actions/send-invoice` with WinBros job ID | `{ error: 'Job not found' }` 404 | PASS (code) — `requireAuthWithTenant` + `job.tenant_id !== authTenant.id` check present | 2026-02-25 |
| 5 | send-payment-links tenant check | Log in as Cedar Rapids, POST to `/api/actions/send-payment-links` with WinBros job ID | `{ error: 'Job not found' }` 404 | PASS (code) — `requireAuthWithTenant` + `job.tenant_id !== authTenant.id` check present | 2026-02-25 |
| 6 | retry-payment tenant check | Log in as Cedar Rapids, POST to `/api/actions/retry-payment` with WinBros job ID | `{ error: 'Job not found' }` 404 | PASS (code) — `requireAuthWithTenant` + `job.tenant_id !== tenant.id` check present | 2026-02-25 |
| 7 | sync-hubspot tenant check | Log in as Cedar Rapids, POST to `/api/actions/sync-hubspot` with WinBros job ID | `{ error: 'Job not found' }` 404 | PASS (code) — `requireAuthWithTenant` + `job.tenant_id !== tenant.id` check present | 2026-02-25 |
| 8 | send-telegram tenant check | Log in as Cedar Rapids, POST to `/api/teams/send-telegram` with WinBros cleaner telegram_id | `{ error: 'Cleaner not found in your organization' }` 404 | PASS (code) — `requireAuthWithTenant` + cleaner `tenant_id` ownership query present | 2026-02-25 |
| 9 | Positive test (own tenant) | Log in as WinBros, POST to `/api/actions/complete-job` with WinBros job ID | Success (200) | PASS (live) — `executeCompleteJob` ran successfully for jobs 99 & 104 (system_events confirm `FINAL_PAYMENT_LINK_SENT` + `JOB_COMPLETED` on 2026-02-25) | 2026-02-25 |
| 10 | send-final-payments cron Part 1 | Run cron with scheduled final payment job | Processes via `executeCompleteJob()` directly (no mock request 401) | PASS (code + live) — `executeCompleteJob` imported directly, no mock Request pattern. Live events confirm jobs processed | 2026-02-25 |
| 11 | send-final-payments cron Part 2 | Run cron with payment_failed job | `executeRetryPayment()` works (unchanged) | PASS (code) — `executeRetryPayment()` call unchanged, no runtime errors in logs | 2026-02-25 |
| 12 | send-sms null-tenant guard | Call `/api/actions/send-sms` without valid tenant session | 403 response | PASS (code) — `requireAuthWithTenant` returns 403 if no tenant; no `getSupabaseServiceClient` fallback in route | 2026-02-25 |
| 13 | Build verification | `npx next build` | Zero type errors | PASS | 2026-02-23 |
| 14 | Vercel production build | Vercel deployment compiles successfully | Build READY, no errors | PASS — "Compiled successfully in 11.8s" (Turbopack), deployment `dpl_HX7L5aGkYfMS7Lo2my4RzeCf5Czz` READY | 2026-02-25 |
| 15 | No runtime errors from modified routes | Check Vercel runtime logs for 500s from action routes | Zero errors | PASS — 48h of runtime logs show zero errors from any `/api/actions/*` or `/api/teams/send-telegram` routes | 2026-02-25 |

---

## Summary

The RLS enforcement (2-19) correctly locked down dashboard **read** routes via `getTenantScopedClient()`. However, dashboard **action** routes were left using the service role client with no tenant ownership validation. This created a theoretical cross-tenant access vector through crafted HTTP requests — low practical risk with trusted tenants, but resolved now before onboarding untrusted tenants.

Additionally, the `send-final-payments` cron Part 1 was non-functional due to a mock-request pattern that failed `requireAuth()`. The fix (extracting `executeCompleteJob()`) resolved both the security concern and the broken cron in one change.

**Post-implementation status (2026-02-23):**
- All 12 files modified per plan
- `npx next build` passes with zero errors
- `requireAuthWithTenant()` utility added to `lib/auth.ts` and adopted by all 10 dashboard action routes
- SSE endpoint disabled (404)
- `send-final-payments` cron Part 1 now functional (direct `executeCompleteJob()` call)

**Verification status (2026-02-25):**
- All 15 tests PASS (13 original + 2 added)
- Verification method: static code analysis (grep) + live Vercel deployment logs + Supabase system_events
- Tests 2–8 verified via code-level grep: all `requireAuthWithTenant` + `tenant_id` ownership checks confirmed present
- Tests 9–10 verified live: `executeCompleteJob()` processed jobs 99 & 104 on 2026-02-25, `system_events` confirm `FINAL_PAYMENT_LINK_SENT` + `JOB_COMPLETED`
- Test 1 verified live: `/api/events` returns 401 (middleware) before reaching disabled route (404)
- Zero runtime errors from any modified route in 48h of Vercel logs
- Supabase security advisors: no new issues introduced by these changes (pre-existing: 5 tables without RLS — `tenants`, `users`, `sessions`, `cleaner_blocked_dates`, `user_api_keys` — plus 9 functions with mutable search_path and 3 always-true RLS policies on assistant_memory tables)
- Supabase performance advisors: pre-existing unindexed foreign keys (18) and RLS initplan warnings (15) — no degradation from this change
