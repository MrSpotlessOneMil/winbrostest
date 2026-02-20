# Verified: Cron Race Condition Fix

**Fix Date:** 2026-02-19
**Verified:** 2026-02-19
**Severity:** High
**Outcome:** Duplicate SMS/notifications eliminated when multiple cron instances fire simultaneously

---

## Problem

All crons used a read-then-write pattern: SELECT eligible rows, process them, then UPDATE a sent_at flag. When Vercel spins up two instances of the same cron (cold start retry, edge region duplication), both grab the same rows and send duplicate messages.

```
Before:  SELECT WHERE sent_at IS NULL → send SMS → UPDATE sent_at
         (both instances grab same rows → duplicate SMS)

After:   RPC: SELECT FOR UPDATE SKIP LOCKED → UPDATE sent_at → RETURN claimed rows
         (Instance A locks row, Instance B's SKIP LOCKED returns nothing)
```

---

## Fix: Distributed Locking via Postgres RPC

### Migration: `scripts/06-cron-locking.sql`

Created 4 RPC functions that atomically claim rows and set the sent_at timestamp. If SMS fails, the cron resets sent_at to null so the job retries next run.

| Function | Cron | Claims By |
|----------|------|-----------|
| `claim_jobs_for_followup` | post-job-followup | `followup_sent_at` |
| `claim_jobs_for_monthly_followup` | monthly-followup | `monthly_followup_sent_at` |
| `claim_jobs_for_monthly_reengagement` | monthly-reengagement | `monthly_followup_sent_at` |
| `claim_jobs_for_frequency_nudge` | frequency-nudge | `frequency_nudge_sent_at` |

Each function uses:
```sql
SELECT ... FROM jobs
WHERE sent_at IS NULL AND ...
FOR UPDATE SKIP LOCKED
LIMIT p_batch_size
```

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/06-cron-locking.sql` | 4 RPC functions with FOR UPDATE SKIP LOCKED |
| `app/api/cron/post-job-followup/route.ts` | Uses `claim_jobs_for_followup` RPC |
| `app/api/cron/monthly-followup/route.ts` | Uses `claim_jobs_for_monthly_followup` RPC |
| `app/api/cron/monthly-reengagement/route.ts` | Uses `claim_jobs_for_monthly_reengagement` RPC |
| `app/api/cron/frequency-nudge/route.ts` | Uses `claim_jobs_for_frequency_nudge` RPC |

---

## Remaining Crons (Lower Priority)

| Cron | Risk | Status |
|------|------|--------|
| check-timeouts | Medium | Uses `hasSystemEvent()` dedup — adequate for Telegram messages |
| send-reminders | Medium | Uses `hasReminderBeenSent()` dedup — could add unique constraint |
| seasonal-reminders | Medium | JSON tracker dedup — not atomic but daily + batch limit reduces risk |
| ghl-followups | Medium | Delegates to external module — needs separate investigation |
| process-scheduled-tasks | Low | Already has optimistic locking |
| crew-briefing | Low | Read-only, harmless duplicates |
| unified-daily | Low | Orchestrator only |

---

## Verification

### Test 1: RPC Functions Exist

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_type = 'FUNCTION' AND routine_name LIKE 'claim_jobs%';
```

| Function | Present |
|----------|---------|
| `claim_jobs_for_followup` | **Yes** |
| `claim_jobs_for_monthly_followup` | **Yes** |
| `claim_jobs_for_monthly_reengagement` | **Yes** |
| `claim_jobs_for_frequency_nudge` | **Yes** |

Result: **PASS**

### Test 2: All Crons Return 200 (Service Client Fix)

Each cron hit once via curl against `localhost:3000`. Previously all returned 500 or 0 rows due to anon key being blocked by RLS.

| Cron | Status | Response |
|------|--------|----------|
| post-job-followup | 200 | `{"success":true,"processed":0}` |
| monthly-followup | 200 | `{"success":true,"processed":0,"sent":0,"skipped":0}` |
| monthly-reengagement | 200 | `{"success":true,"processed":0}` |
| frequency-nudge | 200 | `{"success":true,"totalSent":0,"totalErrors":0}` |
| check-timeouts | 200 | `{"success":true,"processed":0,"urgentFollowUpsSent":0}` |
| seasonal-reminders | 200 | `{"success":true,"totalSent":1,"totalErrors":0}` |
| process-scheduled-tasks | 200 | `{"success":true,"processed":0}` |

Result: **PASS** — all 7 crons functional, no 500 errors

### Test 3: Race Condition Prevention (Concurrent Execution)

Seeded test job (completed 3 hours ago, `followup_sent_at = NULL`). Fired `post-job-followup` from two terminals simultaneously with 3-second instrumentation delay to ensure transaction overlap.

| Instance | Jobs Claimed | Action |
|----------|-------------|--------|
| `0dcf91e6` | **1** (job 32) | Locked row, processed job |
| `14bd48b2` | **0** | `SKIP LOCKED` — row locked by Instance A |

```
[RACE-TEST] Instance 0dcf91e6 — claimed 1 jobs: [ 32 ]
[RACE-TEST] Instance 14bd48b2 — claimed 0 jobs, exiting
```

Result: **PASS** — duplicate SMS prevented

### Test 4: Retry on SMS Failure

Fired `post-job-followup` against test job with fake phone number `+10000000000`. SMS failed with OpenPhone 400 error.

```
[Post-Job Followup] Failed to send SMS for job 33: OpenPhone API error: 400
```

Checked `followup_sent_at` in Supabase after failure: **NULL**

Result: **PASS** — `followup_sent_at` reset to null on failure, job will retry on next cron run

---

## Summary

| Test | Result |
|------|--------|
| RPC functions created in Supabase | **PASS** |
| All 7 crons return 200 (service client fix) | **PASS** |
| Race condition prevented (SKIP LOCKED) | **PASS** |
| Retry on SMS failure (reset sent_at) | **PASS** |

All cron race condition fixes verified. Test data cleaned up.