# In Progress: Payment Retry + Card Update Flow Verification

**Implementation Date:** 2026-02-19
**Verification Date:** 2026-02-20
**Verification Status:** IN PROGRESS (Vercel deployment pending)
**Severity:** High (silent revenue loss on declined final payments)
**Master Plan Reference:** Priority 3, Item 12

---

## Problem

When a customer's card is declined on the final payment (50% remaining balance after cleaning), the system had **zero failure handling**:
- No webhook handler for `payment_intent.payment_failed`
- No customer notification of the decline
- No owner/admin alert
- No retry mechanism (manual or automatic)
- No `payment_failed` status tracking on the job

The customer hit a dead end with no way to recover, and the business had no visibility into lost revenue.

---

## Fix Implemented

### 1. Stripe Webhook Handler (`payment_intent.payment_failed`)
- Catches declined card events from Stripe
- Updates job `payment_status` to `'payment_failed'`
- Tracks failure details in job notes (`PAYMENT_FAILED: <timestamp> | <code> | <message>`)
- Sends customer SMS on first failure with retry link
- Alerts owner via Telegram on every failure
- Logs `PAYMENT_FAILED` system event

### 2. Retry Payment Endpoint (`POST /api/actions/retry-payment`)
- Calculates remaining balance (same math as complete-job: price * 1.03 - deposits - addons)
- Creates a new Stripe payment link
- Sends customer SMS with new payment link
- Tracks `PAYMENT_RETRY_COUNT` in job notes
- Auth-protected for admin/dashboard use

### 3. Auto-Retry via Cron (`/api/cron/send-final-payments`)
- Added Part 2 to existing cron: auto-retries failed payments
- Calls `executeRetryPayment()` directly (bypasses HTTP auth)
- Retries up to 3 times, 24 hours apart
- Logs `PAYMENT_RETRY_SENT` system event per retry

### 4. SMS Templates
- `paymentFailed(paymentUrl)` — sent to customer on first decline
- `paymentRetry(businessName, amount, paymentUrl)` — sent on each auto-retry

### 5. Type Update
- Added `'payment_failed'` to `Job.payment_status` union type

---

## Files Changed (Original Implementation)

| File | Change |
|------|--------|
| `app/api/webhooks/stripe/route.ts` | Added `payment_intent.payment_failed` case + `handlePaymentIntentFailed()` handler |
| `app/api/actions/retry-payment/route.ts` | **NEW** — retry payment endpoint with `executeRetryPayment()` core function |
| `app/api/cron/send-final-payments/route.ts` | Added Part 2: auto-retry failed payments (up to 3 retries, 24h apart) |
| `lib/sms-templates.ts` | Added `paymentFailed()` and `paymentRetry()` templates |
| `lib/system-events.ts` | Added `PAYMENT_RETRY_SENT` to `SystemEventType` union |
| `lib/supabase.ts` | Added `'payment_failed'` to `Job.payment_status` type |

---

## RLS Bugs Discovered & Fixed During Verification

During verification testing, multiple RLS-related bugs were discovered. All stem from the same root cause: after the 2-19 RLS enforcement, any code using `getSupabaseClient()` (anon key) without a tenant JWT silently returns 0 rows.

### Bug 1: Helper functions in `lib/supabase.ts`

5 helper functions hardcoded `getSupabaseClient()` with no way to override. All action routes and webhook handlers calling these helpers were silently failing.

**Fix:** Added optional `overrideClient` parameter to all 5 functions:

| Function | File |
|----------|------|
| `getJobById(jobId, overrideClient?)` | `lib/supabase.ts` |
| `updateJob(jobId, data, options, overrideClient?)` | `lib/supabase.ts` |
| `getAllJobs(userId?, overrideClient?)` | `lib/supabase.ts` |
| `getCustomerByPhone(phone, overrideClient?)` | `lib/supabase.ts` |
| `appendToTextingTranscript(phone, text, overrideClient?)` | `lib/supabase.ts` |

Updated callers in `complete-job`, `retry-payment`, `send-final-payments`, and `stripe webhook` to pass `getSupabaseServiceClient()`.

### Bug 2: `lib/system-events.ts` — system events + Telegram reads

Both `logSystemEvent()` and `getTelegramConversation()` used `getSupabaseClient()`.

**Impact:**
- Every `logSystemEvent()` call across the entire app silently failed since 2-19 RLS enforcement — all system events were dropped
- `getTelegramConversation()` returned 0 rows — Telegram bot lost all conversation context

**Fix:** Switched both to `getSupabaseServiceClient()`. Removed unused `getSupabaseClient` import.

### Bug 3: Comprehensive Stripe webhook RLS failure

Every handler function in the Stripe webhook was affected — using anon key directly or via helper functions without override. This meant deposits, final payments, tips, card-on-file saves, and payment intent processing all silently failed to update the database.

**Fix:** Patched every handler:

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

Removed unused `getSupabaseClient` import from the file entirely.

### Bug 4: Missing `customer_id` column on `system_events` table

`logSystemEvent()` TypeScript interface included `customer_id` but the database table didn't have the column. Caused `PGRST204` error on insert.

**Fix:** `ALTER TABLE system_events ADD COLUMN customer_id TEXT;`

---

## Verification Results

### Pre-verification (build + Stripe config)

| Test | Result | Notes |
|------|--------|-------|
| Local build (`next build`) | PASS | All routes compile, no type errors |
| Stripe webhook import (test mode) | PASS | Imported live webhooks into test mode |
| Stripe webhook signing secret | PASS | Updated test mode secret, signature validation passes |
| Stripe `payment_intent.payment_failed` delivery | PASS | Webhook returns 200 OK after decline test |
| Decline card test (`4000 0000 0000 0002`) | PASS | Stripe fires `payment_intent.payment_failed` + `charge.failed` events |

### Functional verification (Tests 1-8)

All tests run against test job ID 64 (WinBros tenant) with Stripe CLI forwarding webhooks to localhost.

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Job `payment_status` updates to `payment_failed` | PASS | Notes updated with `PAYMENT_FAILED: <timestamp> \| card_declined \| Your card was declined.` |
| 2 | Customer SMS sent on decline | PASS | Message logged in `messages` table with `role = 'assistant'`, `source = 'stripe_payment_failed'` |
| 3 | `PAYMENT_FAILED` system event logged | PASS | Row in `system_events` with job_id, failure_code, failure_message in metadata. Required system-events.ts RLS fix first. |
| 4 | Owner Telegram alert on decline | PASS | Telegram message received with customer phone, amount, reason, job ID. Required tenant `owner_telegram_chat_id` correction. |
| 5 | Manual retry via `/api/actions/retry-payment` | PASS | Response included `paymentUrl`, `remainingAmount`, `retryCount: 1`, `smsSent: true`. SMS received. `PAYMENT_RETRY_COUNT` set in notes. |
| 6 | Auto-retry via cron (backdated 24h+) | PASS | Cron response: `retries_sent: 1`. New SMS received with retry payment link. `PAYMENT_RETRY_COUNT` incremented. |
| 7 | Auto-retry cap at 3 attempts | PASS | Set `PAYMENT_RETRY_COUNT: 3` in notes. Cron response: `retries_sent: 0`. No SMS sent. |
| 8 | Successful payment after retry | PASS | Paid with `4242 4242 4242 4242` on retry link. `payment_status` changed to `fully_paid`, `paid = true`. Notes preserved failure/retry history as audit trail. Required comprehensive webhook RLS fix first. |

### Production deployment (Tests 9-10)

| # | Test | Result | Notes |
|---|------|--------|-------|
| 9 | Production deployment to Vercel | PENDING | Deploy and confirm `payment_intent.payment_failed` in live Stripe webhook events |
| 10 | Revert test Stripe webhook secret | PENDING | Restore live `STRIPE_WEBHOOK_SECRET` in Vercel env vars |

---

## Payment Decline Flow (verified end-to-end)

1. Customer pays via app-generated Stripe payment link (with `job_id` metadata)
2. Card is declined → Stripe fires `payment_intent.payment_failed`
3. Webhook matches event to job via metadata `job_id`
4. Job `payment_status` → `payment_failed`, failure details appended to notes
5. **First failure only:** Customer receives SMS with payment retry link
6. **Every failure:** Owner receives Telegram alert with customer phone, amount, decline reason, job ID
7. `PAYMENT_FAILED` system event logged
8. 24 hours later: cron auto-retries by sending new payment link via SMS (up to 3 times)
9. Manual retry available anytime via `POST /api/actions/retry-payment`
10. After 3 auto-retries: job stays in `payment_failed` — requires manual owner intervention
11. On successful payment: `payment_status` → `fully_paid`, `paid = true`, notes preserve audit trail

---

## Pre-Existing Issue Noted

The cron job's Part 1 (scheduled final payments) calls `completeJobAction` via a **mock HTTP request**, which may fail `requireAuth` the same way the retry originally would have. This was not fixed (out of scope) but should be addressed in a future pass. The retry path (Part 2) avoids this by calling `executeRetryPayment()` directly.
