# 11-Bug Complete Fix Package — 2026-04-20

Branch: `fix/11-bug-complete-2026-04-20`

This document is the index for the complete fix package shipped after the
West Niagara (Paige Elizabeth) and Texas Nova (Linda Kingcade, Rosemary
Johnson, Natasha Jones, James Shannon, Miguel Cruz, Shantia Antoine) incidents.
Eleven distinct bugs, all addressed end-to-end with code, tests, migrations,
and runbooks.

## Bug index

| ID | Symptom | Root cause | Fix |
|----|---------|------------|-----|
| **T8** | AI hallucinated "you're all set, confirmed for Monday 9am" without a real booking | Freeform LLM output, no template gate on confirmation language | `sms-guard.ts` `BOOKING_CONFIRMATION_PATTERNS` + `hasConfirmedBooking` param. Preventive prompt clauses in `auto-response.ts` and `hc-sms-responder.ts`. Regen prompt updated. |
| **T1** | Web form returns generic "Something went wrong" | Generic catch swallowing PostgrestError details | Structured `logSystemEvent` with `code/message/details/hint`. Client gets reference ID. New `/api/health/form-submit?tenant=<slug>` probe checks 7 preconditions. |
| **W1** | Agent reverts to stale appointment time after operator correction | (a) Conversation history weighted higher than `activeJobs` in prompt. (b) Operator correction never updated `jobs.scheduled_at`. | (a) "AUTHORITATIVE APPOINTMENT (overrides history)" prompt elevation. (b) New `extract-datetime-correction.ts` with regex pre-filter + Haiku extraction; updates `jobs.scheduled_at` when operator's SMS contains a time change (confidence ≥ 0.7). |
| **W2** | Cold nurture sent to already-booked customer | Crons filtered on quote row state, ignored other confirmed jobs | New `has-confirmed-booking.ts` (`customerHasConfirmedBooking` + `customersWithConfirmedBookings` batch). Wired into `follow-up-quoted`, `lifecycle-auto-enroll`, `seasonal-reminders`. `lifecycle-reengagement` already safe. |
| **T2** | GHL still messaging Texas Nova customers | Legacy bridge wasn't decommissioned | (a) `/api/webhooks/ghl` returns **410 Gone** for `texas-nova` slug. (b) `/api/cron/ghl-followups` cancels pending rows for the tenant. Plus Patrick's full GHL-side runbook in `docs/ghl-decom-texas-nova.md`. |
| **T6** | Outreach SMS sent at 1:38 AM local | No quiet-hours gate on the send layer | New `timezone-from-area-code.ts` (area-code → IANA mapping for our markets). `sendSMS` accepts `kind: 'transactional' \| 'outreach' \| 'internal'`. `kind='outreach'` outside the 9am–9pm local window is enqueued in new `sms_outreach_queue` table. New `/api/cron/drain-sms-queue` (every 5 min) sends queued rows when their window opens. |
| **T3** | Agent re-asks form-submitted fields | `lead.form_data` never injected into prompt context | New `KNOWN FACTS FROM FORM SUBMISSION` block in `formatCustomerContextForPrompt`. Explicit "do NOT re-ask" guard. |
| **T5** | No follow-up after no-reply on cold outreach | No cadence cron existed | New `cold-followup-templates.ts` (3 stages: +4h, +1d, +3d). New `/api/cron/cold-followup` (every 30 min). Migration adds `customers.cold_followup_stage` + `last_cold_followup_at`. Cancels on any inbound, job creation, takeover, or escalation. |
| **T4** | Intake stalled after collecting bed/bath | No deterministic transition from "intake complete" to "send quote" | New `intake-state-machine.ts`. `decideIntake({snapshot})` returns `complete/gaps/focus/nextQuestion`. Wired into `hc-sms-responder.ts` so prompt always knows what to ask next or to fire `[BOOKING_COMPLETE]`. |
| **T7** | Quote inflated ($562 for 3/2 deep + addons) | Per-tenant `pricing_tiers`/`pricing_addons` seed audit needed; pricing function itself is correct | Runtime sanity assertion in `computeQuoteTotal` (warns when subtotal > 2.5× base). Tier-inclusion regression tests confirm baseboards/ceiling_fans etc. are $0 in deep tier across every tenant. Seed audit is a Phase 0 data task with Patrick's rate card. |
| **W3** | Human operator's intervention not respected by crons | Existing `auto_response_paused` is short-lived (15min). No long-form takeover signal. | Migration adds `customers.human_takeover_until`. New `can-send-outreach.ts` wrapper bundles every skip condition (opt-out, takeover, confirmed booking, retargeting exclusion, quiet hours). New `/api/cron/release-takeover` (daily) clears expired holds. |

## Cross-cutting infrastructure

- **`conversation_state` table** (migration 39): denormalized per-(tenant, phone) row with booking_status / appointment_at / human_takeover_until / known_facts / timezone / cadence counters. Maintained by triggers on `jobs`, `messages`, `customers`. Indexed for cold-cadence selection, takeover lookup, and booking-status filtering.
- **`template-gate.ts`**: every outbound template declares the state it requires. `canFire(templateId, state)` is the last line of defense against firing the wrong template against the wrong lifecycle state. Covers `booking_confirmation`, `appointment_reminder_24h`, `quote_followup`, `cold_followup_1/2/3`, `retargeting_nudge`, `seasonal_reminder`, `post_job_rebook`.

## What changed (file-by-file)

**New core helpers (packages/core/src/):**
- `has-confirmed-booking.ts` — `customerHasConfirmedBooking`, `customersWithConfirmedBookings` batch
- `extract-datetime-correction.ts` — regex pre-filter + Haiku extractor for operator messages
- `timezone-from-area-code.ts` — area-code → IANA, `isWithinQuietHoursWindow`, `nextAllowedSendAt`
- `can-send-outreach.ts` — single bundled gate
- `template-gate.ts` — template state-gate engine
- `cold-followup-templates.ts` — T5 stage templates + threshold constants
- `intake-state-machine.ts` — deterministic intake decision

**Modified core helpers:**
- `sms-guard.ts` — `BOOKING_CONFIRMATION_PATTERNS` + `hasConfirmedBooking` param
- `auto-response.ts` — authoritative-appointment elevation, KNOWN FACTS section, booking-language prompt clause
- `quote-pricing.ts` — 2.5× sanity warning
- `openphone.ts` — `kind` param + quiet-hours queue integration; removed `process.env.OPENPHONE_PHONE_ID` fallback (cross-tenant brand-leak fix)

**Modified routes:**
- `apps/house-cleaning/app/api/webhooks/openphone/route.ts` — pass `hasConfirmedBooking` to guard, regen prompt steer-away, W1 datetime extraction trigger
- `apps/house-cleaning/app/api/webhooks/openphone/hc-sms-responder.ts` — booking-language clause, intake-state-machine wiring
- `apps/house-cleaning/app/api/webhooks/ghl/route.ts` — 410 Gone for decommissioned tenants
- `apps/house-cleaning/app/api/webhooks/website/[slug]/route.ts` — structured errors
- `apps/house-cleaning/integrations/ghl/follow-up-scheduler.ts` — kill switch
- `apps/house-cleaning/app/api/cron/follow-up-quoted/route.ts` — confirmed-booking skip
- `apps/house-cleaning/app/api/cron/lifecycle-auto-enroll/route.ts` — confirmed-booking skip
- `apps/house-cleaning/app/api/cron/seasonal-reminders/route.ts` — confirmed-booking skip
- `apps/house-cleaning/vercel.json` — register 3 new crons

**New routes:**
- `apps/house-cleaning/app/api/health/form-submit/route.ts` — preflight diagnostic
- `apps/house-cleaning/app/api/cron/drain-sms-queue/route.ts` — drains quiet-hours queue
- `apps/house-cleaning/app/api/cron/cold-followup/route.ts` — T5 cadence
- `apps/house-cleaning/app/api/cron/release-takeover/route.ts` — clears expired W3 holds

**Migrations (scripts/):**
- `37-conversation-lifecycle-columns.sql` — adds customer-level lifecycle columns
- `38-sms-outreach-queue.sql` — quiet-hours queue table
- `39-conversation-state.sql` — denormalized state table + maintenance triggers

**Tests (tests/regression/):**
- `t1-form-submit-structured-errors.test.ts`
- `t2-ghl-decommissioned.test.ts`
- `t3-known-facts-dedup.test.ts`
- `t4-intake-to-quote.test.ts`
- `t5-cold-cadence.test.ts`
- `t6-quiet-hours-enforced.test.ts`
- `t7-pricing-sanity.test.ts`
- `t8-no-hallucinated-confirmation.test.ts`
- `w1-datetime-extraction.test.ts`
- `w2-confirmed-booking-skip.test.ts`
- `w3-takeover-respected.test.ts`
- `template-gate.test.ts`

**Docs (docs/):**
- `11-bug-fix-package.md` (this file)
- `texas-nova-onboarding.md`
- `ghl-decom-texas-nova.md`

## Test status

`npx vitest run` — **605 tests / 71 files / all green**.

## Deployment plan

Deploy in this order to minimize blast radius. Each step verifies before
moving on.

1. **Apply migrations** in Supabase (37, 38, 39). Triggers populate
   `conversation_state` lazily — existing rows get backfilled by future events
   or a one-shot UPSERT script (not included; can be added if you want).
2. **Merge to `main`** — both `osiris-house-cleaning` and `osiris-window-washing`
   auto-deploy on Vercel. The window-washing app is unaffected (shared code
   improvements only).
3. **Smoke test on Spotless** within 5 minutes:
   - Send an inbound SMS with a confirmation-style phrase to verify the guard.
   - Submit a website form to verify structured errors.
   - Watch logs for `SMS GUARD BLOCKED: Hallucinated confirmation` (should fire if AI tries to claim a booking that doesn't exist).
4. **Hit the health probe** on each tenant:
   ```bash
   for slug in spotless-scrubbers cedar-rapids west-niagara; do
     curl -H "Authorization: Bearer $CRON_SECRET" \
       "https://cleanmachine.live/api/health/form-submit?tenant=$slug"
   done
   ```
   Fix any `ok: false` checks for existing tenants before onboarding Texas Nova.
5. **Onboard Texas Nova** following `docs/texas-nova-onboarding.md`.
6. **Run GHL decom** (Patrick) following `docs/ghl-decom-texas-nova.md`.

## Rollback

Each migration is additive and nullable/defaulted — no destructive changes
to existing schema. To roll back code only: revert the merge commit; data
in new tables stays for forensic review. To fully roll back a single
migration: `DROP TABLE conversation_state CASCADE` (drops triggers too),
`DROP TABLE sms_outreach_queue`, `ALTER TABLE customers DROP COLUMN
cold_followup_stage, DROP COLUMN last_cold_followup_at, DROP COLUMN
human_takeover_until, DROP COLUMN last_human_operator_message_at`.
