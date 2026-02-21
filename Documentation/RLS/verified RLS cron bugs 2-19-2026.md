# Verified: RLS Refactoring Cron Bugs

**Fix Date:** 2026-02-19
**Verified:** 2026-02-19
**Severity:** Critical (silent failures — all crons returning 0 rows)
**Outcome:** All cron routes fixed and returning 200

---

## Problem

After the RLS refactor (2-19), cron routes still called `getSupabaseClient()` which returns the **anon key** client. With RLS now enforced, the anon key requires a tenant JWT to see any data. Crons don't have tenant JWTs — they process all tenants.

**Result:** Every cron silently returned 0 rows. No SMS, no followups, no reminders sent.

### Secondary Bug: Wrong Column in post-job-followup

The SELECT query referenced `stripe_payment_link` which exists on the **leads** table, not the **jobs** table. This caused a 500 error on every run.

---

## Fix

Changed all crons to use `getSupabaseServiceClient()` (service role key, bypasses RLS). Fixed column reference to `stripe_payment_intent_id`.

| File | Before | After |
|------|--------|-------|
| `cron/post-job-followup/route.ts` | `getSupabaseClient()` | `getSupabaseServiceClient()` |
| `cron/monthly-followup/route.ts` | `getSupabaseClient()` | `getSupabaseServiceClient()` |
| `cron/monthly-reengagement/route.ts` | `getSupabaseClient()` | `getSupabaseServiceClient()` |
| `cron/frequency-nudge/route.ts` | `getSupabaseClient()` | `getSupabaseServiceClient()` |
| `cron/check-timeouts/route.ts` | `getSupabaseClient()` | `getSupabaseServiceClient()` |
| `cron/seasonal-reminders/route.ts` | `getSupabaseClient()` | `getSupabaseServiceClient()` |
| `cron/process-scheduled-tasks/route.ts` | `getSupabaseClient()` | `getSupabaseServiceClient()` |

---

## Impact

Since the RLS deployment (2-19), the following features were silently broken:
- Post-job follow-up SMS (review requests, tip links, recurring offers)
- Monthly re-engagement SMS
- Frequency nudge SMS
- Seasonal campaign SMS
- Check-timeouts alerts
- Scheduled task processing

---

## Verification

All 7 crons hit via curl against `localhost:3000` — every one returns 200 with valid responses:

| Cron | Status | Response |
|------|--------|----------|
| post-job-followup | 200 | `{"success":true,"processed":0}` |
| monthly-followup | 200 | `{"success":true,"processed":0,"sent":0,"skipped":0}` |
| monthly-reengagement | 200 | `{"success":true,"processed":0}` |
| frequency-nudge | 200 | `{"success":true,"totalSent":0,"totalErrors":0}` |
| check-timeouts | 200 | `{"success":true,"processed":0,"urgentFollowUpsSent":0}` |
| seasonal-reminders | 200 | `{"success":true,"totalSent":1,"totalErrors":0}` |
| process-scheduled-tasks | 200 | `{"success":true,"processed":0}` |

Result: **PASS** — all crons functional, no 500 errors

---

## Summary

The RLS refactor inadvertently broke all cron routes by switching them to a client that respects RLS policies. Crons need service-level access to process all tenants. Fixed by using `getSupabaseServiceClient()` in all 7 cron routes and correcting the wrong column reference.