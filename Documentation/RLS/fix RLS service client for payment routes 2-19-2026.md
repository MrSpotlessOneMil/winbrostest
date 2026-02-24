# Fix: RLS Service Client for Payment Routes

**Fix Date:** 2026-02-19 (updated 2026-02-20)
**Severity:** Critical (silent failures — payment retry flow completely non-functional)
**Outcome:** All payment action routes, webhook handler, cron, system events, and Telegram reads updated to bypass RLS

---

## Problem

After the RLS enforcement (2-19), the new payment retry flow and several existing action routes still used helper functions (`getJobById`, `updateJob`, `getAllJobs`, `getCustomerByPhone`, `appendToTextingTranscript`) that internally call `getSupabaseClient()` — the **anon key** client. With RLS enforced, the anon key requires a `tenant_id` claim in the JWT to see any data. Webhooks, crons, and admin action routes don't have tenant JWTs.

**Result:** Every query silently returned 0 rows / null. The `complete-job` endpoint returned `{ error: 'Job not found' }` for valid jobs. The webhook handler, retry endpoint, and cron would all fail silently.

This is the same class of bug as the cron RLS fix (see `verified RLS cron bugs 2-19-2026.md`), but affecting helper functions used by action routes and the Stripe webhook rather than direct client calls in cron routes.

---

## Root Cause

The 5 helper functions in `lib/supabase.ts` hardcoded `getSupabaseClient()` (anon key) with no way to override:

```typescript
// Before — hardcoded anon key, blocked by RLS for non-tenant callers
export async function getJobById(jobId: string): Promise<Job | null> {
  const client = getSupabaseClient()  // anon key — RLS blocks without tenant JWT
  ...
}
```

All 4 affected routes imported and called these helpers, inheriting the RLS block.

---

## Fix

### Part 1: Added optional `overrideClient` parameter to 5 helper functions

| Function | File |
|----------|------|
| `getJobById(jobId, overrideClient?)` | `lib/supabase.ts` |
| `updateJob(jobId, data, options, overrideClient?)` | `lib/supabase.ts` |
| `getAllJobs(userId?, overrideClient?)` | `lib/supabase.ts` |
| `getCustomerByPhone(phone, overrideClient?)` | `lib/supabase.ts` |
| `appendToTextingTranscript(phone, text, overrideClient?)` | `lib/supabase.ts` |

Non-breaking change — existing callers default to `getSupabaseClient()`. Routes that need service-level access pass `getSupabaseServiceClient()`.

### Part 2: Updated 4 routes to pass service client

| File | Change |
|------|--------|
| `app/api/actions/complete-job/route.ts` | Added `getSupabaseServiceClient()`, passed to `getJobById`, `getCustomerByPhone`, `updateJob`, `appendToTextingTranscript` |
| `app/api/actions/retry-payment/route.ts` | Added `getSupabaseServiceClient()`, passed to `getJobById`, `getCustomerByPhone`, `updateJob` |
| `app/api/webhooks/stripe/route.ts` | **Comprehensive fix** — every handler function patched (see Part 4 below) |
| `app/api/cron/send-final-payments/route.ts` | Added `getSupabaseServiceClient()`, passed to `getAllJobs` and both `updateJob` calls |

### Part 3: Fixed `lib/system-events.ts` — system event logging and Telegram reads

Discovered during verification testing: `logSystemEvent()` and `getTelegramConversation()` both used `getSupabaseClient()` (anon key). With RLS enforced:

- **`logSystemEvent()`** — All system event inserts silently failed. The insert was blocked by RLS (no tenant JWT), caught by try/catch, and only logged to console. **Every system event since the 2-19 RLS enforcement was silently dropped.**
- **`getTelegramConversation()`** — All Telegram conversation reads returned 0 rows. The Telegram bot's context memory was effectively wiped.

| Function | File | Before | After |
|----------|------|--------|-------|
| `logSystemEvent()` | `lib/system-events.ts` | `getSupabaseClient()` | `getSupabaseServiceClient()` |
| `getTelegramConversation()` | `lib/system-events.ts` | `getSupabaseClient()` | `getSupabaseServiceClient()` |

Removed the now-unused `getSupabaseClient` import from the file entirely.

Also fixed: missing `customer_id` column on `system_events` table — TypeScript interface included it but the DB schema did not, causing `PGRST204` errors on insert. Fixed with `ALTER TABLE system_events ADD COLUMN customer_id TEXT;`.

### Part 4: Comprehensive Stripe webhook RLS fix (`app/api/webhooks/stripe/route.ts`)

Discovered during Test 8 verification: `handleFinalPayment()` called `updateJob()` without service client, so successful payments after retry didn't update `payment_status`. Investigation revealed **every handler function** in the webhook had the same issue.

| Handler | Changes |
|---------|---------|
| `handleCheckoutSessionCompleted` | Added `serviceClient`, passed to `getJobById` |
| `handleDepositPayment` | Added `serviceClient`, passed to `updateJob` (2 calls), replaced anon key for customer lookup, lead lookup, message inserts (2 places) |
| `handleFinalPayment` | Added `serviceClient`, passed to `updateJob` |
| `handleTipPayment` | Replaced `getSupabaseClient()` with `getSupabaseServiceClient()`, fixed `getJobById` |
| `handlePaymentIntentSucceeded` | Passed `getSupabaseServiceClient()` to `getJobById` |
| `handlePaymentIntentFailed` | Added `serviceClient`, passed to `getJobById`, `updateJob` |
| `handleCardOnFileSaved` | Replaced `getSupabaseClient()` with `getSupabaseServiceClient()`, fixed `getJobById` (2 calls), `updateJob` |
| `getCustomerEmail` helper | Replaced `getSupabaseClient()` with `getSupabaseServiceClient()` |

Removed unused `getSupabaseClient` import from the file entirely. Zero `getSupabaseClient()` calls remain.

---

## Impact

Without these fixes, the following features were completely non-functional after RLS enforcement:

- **Complete job** — `POST /api/actions/complete-job` returned "Job not found" for all jobs
- **Payment failed webhook** — `payment_intent.payment_failed` handler couldn't find the job, silently returned without updating status, sending SMS, or alerting owner
- **Retry payment** — `POST /api/actions/retry-payment` returned "Job not found" for all jobs
- **Auto-retry cron** — `send-final-payments` cron fetched 0 jobs, never retried any failed payments
- **System events** — Every `logSystemEvent()` call across the entire app silently failed. No events logged to `system_events` table since 2-19 RLS enforcement
- **Telegram bot context** — `getTelegramConversation()` returned 0 rows, so the Telegram bot lost all conversation history/context
- **Deposit payments** — `handleDepositPayment` couldn't update job status, look up customers, or insert confirmation messages
- **Final payments** — `handleFinalPayment` couldn't update `payment_status` to `fully_paid` — successful payments after retry appeared stuck in `payment_failed`
- **Tip payments** — `handleTipPayment` couldn't look up or update jobs
- **Card-on-file saves** — `handleCardOnFileSaved` couldn't look up jobs, create jobs from leads, or assign cleaners
- **Payment intent success** — `handlePaymentIntentSucceeded` couldn't look up jobs for logging

---

## Verification

- `next build` passes with zero type errors
- Full payment retry flow verified end-to-end (Tests 1-8 PASS) — see `In Progress Verification payment retry 2-19-2026.md`
- Production deployment pending (Tests 9-10)

---

## Summary

The RLS enforcement broke all routes that used the shared helper functions in `lib/supabase.ts`, because those helpers hardcoded the anon key client. Fixed by adding an optional `overrideClient` parameter to 5 helpers and passing `getSupabaseServiceClient()` from all affected routes.

Additionally, `lib/system-events.ts` had the same bug — both `logSystemEvent()` and `getTelegramConversation()` used the anon key, silently dropping all system event inserts and returning empty Telegram conversation history since the 2-19 RLS enforcement. Fixed by switching both to `getSupabaseServiceClient()`.

The most critical fix was the comprehensive Stripe webhook overhaul (Part 4) — every handler function (`handleDepositPayment`, `handleFinalPayment`, `handleTipPayment`, `handleCardOnFileSaved`, `handlePaymentIntentSucceeded`, `handlePaymentIntentFailed`, `handleCheckoutSessionCompleted`, and `getCustomerEmail`) was using the anon key directly or via unpatched helper calls. This meant the entire Stripe payment processing pipeline was silently broken since RLS enforcement. All handlers now use `getSupabaseServiceClient()`.

All changes are non-breaking — existing tenant-scoped callers are unaffected.