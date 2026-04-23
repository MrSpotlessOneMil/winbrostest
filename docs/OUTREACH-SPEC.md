# Retargeting + Follow-up — FROZEN SPEC v1.0

**Status**: Frozen 2026-04-22. No code changes to frozen files without Dominic's per-session authorization (see Freeze section).

**Owner**: Dominic Lutz (Spotless Scrubbers / Osiris).

**Scope**: How every non-operational outbound message to a customer is decided, generated, timed, and tracked across every Osiris house-cleaning tenant.

---

## Table of Contents

1. Context
2. Hard Rules (never change without updating this doc)
3. The Railway (customer state machine)
4. Single Eligibility Gate
5. Pipeline A — Pre-Quote Follow-up
6. Pipeline B — Post-Quote Follow-up
7. Pipeline C — Retargeting Drip
8. The Humanity Engine
9. A/B Testing Infrastructure
10. Safeguards (how we keep this from breaking)
11. Staged Rollout Plan
12. File Plan
13. Test + Verification Plan
14. Freeze Mechanism
15. Acceptance Checklist (must be green before enabling)
16. Rollback Plan
17. Change Log

---

## 1. Context

The old system had 10 overlapping crons each doing their own eligibility check. On 2026-04-22, a West Niagara audit showed cold-followup firing at customers with `pending` jobs and `admin_disabled` flags. Phase 1 (same day) paused everything via kill-switch + flushed 64 queued tasks.

**This plan is Phase 2**: rebuild with one state machine, one gate, two follow-up pipelines, one retargeting drip, and a humanity engine that makes every message sound like a text from the owner — not a brand.

**Governing principle**: if the message reads like it came from Mailchimp, it's wrong. If it could plausibly be Dominic (or Mary, or Caleb) texting a friend at 7pm, it's right.

---

## 2. Hard Rules (never change without updating this doc)

1. **Never message a customer on an active membership.** Zero exceptions.
2. **Never message a customer with any active job** (`pending`, `quoted`, `scheduled`, `in_progress`). Zero exceptions.
3. **Never message a customer with `retargeting_stopped_reason = admin_disabled`.**
4. **AI has zero price authority outside Post-Quote stage 3.** Even then, capped per tenant in `workflow_config.post_quote_max_discount`.
5. **Every retargeting message must reference at least one real thing from the customer's chat history.** The linter rejects messages without a callback.
6. **Banned phrases** (linter-enforced): `valued customer, exclusive offer, limited time, we've upgraded, dear, synergy, as a courtesy, book now!, 🎉🎉🎉`.
7. **Kill switch always works**: `RETARGETING_DISABLED=true` env short-circuits every cron + task executor. Cannot be bypassed by code paths.
8. **No auto-edits to frozen files.** See Freeze Mechanism.
9. **WinBros is excluded from all of this.** Jack handles his own outreach.
10. **Manual-managed customers** (Raza, Mahas, tenant-configured list) are never auto-messaged.

---

## 3. The Railway (customer state machine)

Single column `customers.lifecycle_state`. Outreach decisions fall out of state, never from a cron independently deciding.

```
              NEW LEAD FORM/CALL/TEXT
                        │
                        ▼
                   new_lead
                        │ AI first outbound
                        ▼
                   engaged  ◄───────────┐
                        │               │
              quote sent │               │ inbound reply
                        ▼               │ during retargeting
                   quoted ◄──────┐      │
                        │        │      │
             approves   │        │      │
                        ▼        │      │
                   approved      │      │
                        │ job on calendar
                        ▼        │      │
                   scheduled     │      │
                        │ cleaner starts│
                        ▼        │      │
                   in_service    │      │
                        │ cleaner done  │
                        ▼        │      │
              awaiting_payment   │      │
                        │ payment received
                        ▼        │      │
                     paid        │      │
                        │        │      │
               ┌────────┴────────┤      │
       membership    30d no rebook,     │
       created       no active job      │
               │        │               │
               ▼        ▼               │
          recurring  retargeting ───────┘
               │ (cancels)
               └──►  retargeting
```

**Permitted outreach per state:**

| State | Outreach allowed |
|-------|------------------|
| `new_lead` | AI first touch only |
| `engaged` | Pipeline A (Pre-Quote) |
| `quoted` | Pipeline B (Post-Quote) |
| `approved` | operational scheduling only |
| `scheduled` | operational reminders only |
| `in_service` | operational only |
| `awaiting_payment` | operational only |
| `paid` | post_job_review + recurring push (one each) |
| `recurring` | **zero outreach** |
| `retargeting` | Pipeline C |
| `archived` | **zero outreach ever** |

**Transitions fire from** webhooks + action routes via a single `transitionState(customerId, event)` helper. Not from crons. Auditable in `customer_state_transitions` log table.

---

## 4. Single Eligibility Gate

`apps/house-cleaning/lib/outreach-gate.ts` — one function. Every cron passes through it. No parallel gates, no inline checks anywhere else.

```ts
isEligibleForOutreach(
  customerId: number,
  kind: 'pre_quote' | 'post_quote' | 'retargeting'
): Promise<{ ok: boolean; reason?: string }>
```

Checks in order (all must pass):

1. `lifecycle_state` matches `kind`
2. Not `sms_opt_out`, `auto_response_disabled`, `auto_response_paused`
3. Not `retargeting_stopped_reason = admin_disabled`
4. No active/paused membership
5. No active job in (`pending`, `quoted`, `scheduled`, `in_progress`)
6. Not on manual-managed list
7. Phone is not a cleaner's
8. No active conversation: inbound message within last 30 min (universal, per-tenant override `workflow_config.active_conversation_window_minutes`)
9. For `retargeting`: no inbound reply in last 14 days
10. For email channel: not previously bounced
11. Kill switch: `RETARGETING_DISABLED` env not set to `true`

Every refusal logged to `system_events` with reason + kind + customer_id. Queryable for audit.

---

## 5. Pipeline A — Pre-Quote Follow-up

**Applies when**: `lifecycle_state = engaged`.
**Cron**: `/api/cron/followup-pre-quote` runs every 15 min, business hours gate per tenant.
**AI model**: Haiku 4.5.
**After stage 3 silent**: `transitionState(id, 'graduated_to_retargeting')`.

| Stage | When | Goal | A/B slots |
|-------|------|------|-----------|
| 1 | +4h after last outbound | friendly nudge + the one unblocking Q (bed/bath, address, service type) | A and B |
| 2 | +1d after stage 1 | soft urgency + same Q | A and B |
| 3 | +3d after stage 2 | warm last-ask, no pressure | A and B |

---

## 6. Pipeline B — Post-Quote Follow-up

**Applies when**: `lifecycle_state = quoted`.
**Cron**: `/api/cron/followup-post-quote` runs every 5 min, business hours gate per tenant.
**AI model**: Sonnet 4.6 for stage 1 (needs to read their last message intelligently), Haiku 4.5 for stages 2–4.
**After stage 4 silent**: quote row set to `expired`, `transitionState(id, 'graduated_to_retargeting')`.

| Stage | When | Goal | Offer | A/B slots |
|-------|------|------|-------|-----------|
| 1 | +7min after quote sent | "did you get a chance to look?" — skipped if live convo detected | none | A and B |
| 2 | +4h after stage 1 | value-add — what's included, scope-swap option | none | A and B |
| 3 | +1d after stage 2 | offer close (tenant-capped discount, 7-day deadline) | yes | A and B |
| 4 | +3d after stage 3 | last chance — "slot's coming off the books" | same offer | A and B |

**Universal active-conversation gate** (2026-04-23 update, applies to EVERY pipeline — A, B, C): `outreach-gate.ts` refuses outreach with reason `active_conversation` if the customer sent any inbound message in the last 30 minutes. Default window overridable per tenant via `workflow_config.active_conversation_window_minutes` (0 to disable). Covers: owner manually texting, AI mid-convo, reply-in-flight. Distinct from the 14-day retargeting `recent_inbound` check, which also drives the `retargeting -> engaged` state transition upstream.

**Stage 3 offer cap per tenant** (`workflow_config.post_quote_max_discount`):
- Spotless Scrubbers: 10%
- West Niagara: 15% (CAD)
- Cedar Rapids: 10%
- Texas Nova: 10%

---

## 7. Pipeline C — Retargeting Drip

**Applies when**: `lifecycle_state = retargeting`.
**Cron**: `/api/cron/retargeting-drip` runs daily at 10am UTC, each tenant runs in its own business-hours window.
**AI model**: Haiku 4.5 (high volume, template-guided).
**Duration**: forever until opt-out or re-engagement.

### Timing rules
- ~30 days between touches, jitter ±5 days
- Max 2 per calendar month, min 5 days between any two
- Send windows (tenant-local time):
  - SMS: Tue/Thu 6–8pm OR Fri 3–5pm
  - Email: Tue/Wed 9–11am OR Thu 7–9pm
  - Never Sunday before noon, never Saturday before 11am

### Channel rotation (strict sequence, resets only on inbound)
1. SMS
2. Email (+3 days into next cycle)
3. SMS + MMS (meme / gif / tenant photo)
4. Email
5. SMS
6. Voice note or Loom — **only if** customer's lifetime value > tenant threshold (`workflow_config.high_value_ltv_threshold`, default $400)
7. (repeat from 1)

### Offer escalation (based on days-since-lapse, NOT touch number)
- **30–60 days lapsed**: no offer. Pure human check-in.
- **60–180 days lapsed**: max 1 offer per 60 days. 15% off or free add-on. 7-day deadline.
- **180–365 days lapsed**: max 1 offer per 60 days. 25% off or free deep-clean add-on. 7-day deadline.
- **365+ days lapsed**: seasonal reminders only. No discount unless customer asks.

### Instant exits (drip dies immediately)
- Any inbound reply → `state = engaged`, drip cancelled
- Job creation → `state = scheduled`, drip cancelled
- Membership created → `state = recurring`, drip cancelled
- Opt-out → `state = archived`, drip cancelled forever

---

## 8. The Humanity Engine

Every message in A / B / C is generated through one pipeline that enforces these rules. This is the core bet: a system that writes like a human beats a precisely-timed one that writes like a brand.

### 8.1 Tenant Voice Profile
`tenants.voice_profile` JSONB:

```jsonc
{
  "owner_name": "Dominic",
  "owner_age": 22,
  "owner_vibe": "LA, casual, fast texter, minor typos, lowercase, dry humor, confident not corporate",
  "emoji_set": ["✨", "🧹", "🏡", "😭", "🫡", "🔑", "👋"],
  "never_says": ["valued customer", "exclusive offer", "limited time", "we've upgraded", "as a courtesy"],
  "always_says": ["lowkey", "ngl", "swing by", "the usual"],
  "signature": "– dom",
  "voice_samples": [ /* 10 real chat excerpts from the owner */ ]
}
```

Reverse-engineered from 20 random real owner chats per tenant, then Dominic-approved. Samples guide tone, not copy-paste.

### 8.2 Customer Personality Memory
`customer_memory.personality` JSONB — built and updated as they chat:

- emoji usage pattern
- typo/casing pattern
- their name for their place
- pets (name + type)
- kids (names / ages)
- partner
- inside jokes / recurring bits
- known objections
- last thing they were excited about
- last thing they were annoyed about

Every generation reads this and weaves one reference in naturally.

### 8.3 Callback Reference (mandatory for Pipeline C)
Every retargeting message must reference one real thing from their chat history. Linter rejects messages without a callback.

### 8.4 MMS / Meme / GIF Library
Per-tenant Supabase Storage folder, categorized:
- seasonal
- relatable (dust bunny, disaster kitchen, pet destruction)
- funny (cleaning fails)
- celebratory (before/after, customer wins with permission)
- tenant-branded (Dominic mopping, Mary's team, Caleb's van)

Rotation: ~1 in 3 retargeting touches includes an MMS (starts at 1 in 5 for budget, scales after first month of data).

### 8.5 Voice Note / Loom Escalation
For customers with lifetime value > threshold, touch #6 is a recorded message. Dashboard queues 5/week for the owner; owner records in 15 min batch.

### 8.6 Custom Memes for Top Customers
Highest-LTV lapsed: AI-generated image specific to them (their dog's name on a dust-bunny meme, their house with text overlay, etc).

- Tool: DALL-E-3 / GPT-Image-1 (~$0.04/image)
- **First 6 months: every custom meme requires Dominic approval before send** (human queue in dashboard)
- After 6 months: successful patterns become templates, AI generates auto

### 8.7 Imperfection Allowed
Prompt enforces: casual lowercase, one typo > zero, never perfectly punctuate. AI grammar-check OFF for drip.

### 8.8 Linter (blocks bad messages pre-send)
`lib/message-linter.ts` runs on every AI-generated message. Rejects if:
- contains any `never_says` phrase
- >3 emojis in one message
- contains unreplaced `{placeholder}`
- first name is a carrier keyword (STOP, UNSUBSCRIBE, etc.)
- Pipeline C message without a callback reference
- message length > carrier SMS limit (160 for SMS, 600 for MMS)

Rejected message → regenerate up to 3 times → fallback to template → if still failing, skip send, log `system_events` `OUTREACH_LINT_FAILED`.

---

## 9. A/B Testing Infrastructure

### 9.1 Schema
`message_templates` table:
```
id | pipeline | stage | variant | prompt_template | status (active|retired) | created_at
```

`messages` table gains:
```
template_id | variant ('a' | 'b')
```

`ab_results` materialized view rolls up per-variant:
```
template_id | sent | replied | booked | revenue | opt_outs | last_updated
```

### 9.2 Run loop
1. Each stage starts with 2 variants written/approved by Dominic
2. Cron sends 50/50 split (seed = `customer_id % 2`)
3. Nightly job tallies `ab_results` from `messages` + `jobs` + `payments`
4. After 30 sends per variant in a stage:
   - If winner lift ≥ 15% at p < 0.1 → loser retired, AI generates new B against winner
   - Else continue gathering data
5. Dashboard `/dashboard/ab-results` shows per-stage winner, sample size, suggested next B, lift vs baseline.

### 9.3 Tracked metrics per variant
- Reply rate (% who replied anything within 48h)
- Book rate (% who booked within 14d)
- Revenue per send
- Opt-out rate

### 9.4 Guardrails
- New B variant never auto-deploys without Dominic approval in dashboard
- Stat-sig check before retiring a variant (30 samples minimum, p < 0.1)
- If opt-out rate spikes > 2× baseline, pipeline auto-pauses + pages Dominic

---

## 10. Safeguards (how we keep this from breaking)

### 10.1 Kill switch (already live)
`RETARGETING_DISABLED=true` env halts:
- All 3 pipeline crons (return `{paused:true}` immediately)
- Retargeting task types in `process-scheduled-tasks` (cancel on pickup)

### 10.2 Per-pipeline kill switches (new)
- `PIPELINE_A_DISABLED=true` — stops only pre-quote follow-up
- `PIPELINE_B_DISABLED=true` — stops only post-quote follow-up
- `PIPELINE_C_DISABLED=true` — stops only retargeting drip

Lets us surgical-stop one pipeline without killing the others.

### 10.3 Dry-run mode
`OUTREACH_DRY_RUN=true` env: pipelines run normally, linter runs, messages generated + logged, but `sendSMS`/email are no-ops. Outputs written to `system_events` with `dry_run:true` so we can preview a full day without sending a single message.

### 10.4 Per-tenant enable flag
`tenants.workflow_config.outreach_enabled` (per pipeline). Every pipeline checks per-tenant flag before running for that tenant. Roll out one tenant at a time.

### 10.5 Circuit breakers
If any of these thresholds trip in last 1 hour, pipeline auto-pauses + pages Dominic:
- Opt-out rate > 3% of sends
- Lint failure rate > 10% of generations
- Gate refusal rate > 50% (something's mis-classifying customers)
- Per-tenant send count > tenant daily cap (`workflow_config.max_daily_outreach`, default 100)

### 10.6 Nightly audit cron
`/api/cron/outreach-audit` runs every night at 4am UTC:
- Scans last 24h outbound tagged pipeline_a/b/c
- Any send to a customer whose state blocked it → CRITICAL page
- Any message containing banned phrases → WARN page
- Any member/active-job customer received a touch → CRITICAL page
- Report written to `outreach_audit_reports` table, dashboard view

### 10.7 Shadow-mode comparison
For the first 30 days: pipelines run in dry-run AND shadow-mode. Shadow mode logs what the OLD system would have done, so we can compare and ensure nothing we want is being dropped.

---

## 11. Staged Rollout Plan

**Rule**: do not move to next stage until previous is green for 7 days.

### Stage 0 — Build (all behind kill switch)
- Write all code with `RETARGETING_DISABLED=true`
- Deploy, run tests, run dry-run for 48h
- Dominic reviews 20 sample messages from dry-run

### Stage 1 — Spotless only, dry-run (7 days)
- Flip `outreach_enabled=true` for Spotless only
- Keep `OUTREACH_DRY_RUN=true` — no real sends
- Manually review audit reports daily
- Compare shadow-mode against old system output

### Stage 2 — Spotless only, live (7 days)
- Flip `OUTREACH_DRY_RUN=false` for Spotless
- Daily audit review
- Circuit breakers armed
- Dominic reviews 10 real sends/day

### Stage 3 — Cedar Rapids joins (7 days)
- Same as Stage 2 + Cedar

### Stage 4 — West Niagara joins (7 days)
- Same + WN (CAD currency double-check)

### Stage 5 — Freeze
- Hook added to block further edits to frozen files without explicit unfreeze
- Plan doc marked final
- Change-log section used for all future adjustments

---

## 12. File Plan

### Delete (after Stage 5 green)
- `app/api/cron/cold-followup/route.ts`
- `app/api/cron/lifecycle-reengagement/route.ts`
- `app/api/cron/lifecycle-auto-enroll/route.ts`
- `app/api/cron/seasonal-reminders/route.ts`
- `app/api/cron/follow-up-quoted/route.ts`
- `retargeting` / `lead_followup` / `mid_convo_nudge` / `quote_followup_urgent` handlers in `process-scheduled-tasks/route.ts`
- `lib/cold-followup-templates.ts`
- `RETARGETING_SEQUENCES` + `RETARGETING_TEMPLATES` constants in `lib/scheduler.ts`

### Create (all these join the freeze list)
- `lib/outreach-gate.ts`
- `lib/lifecycle-state.ts`
- `lib/message-generator.ts`
- `lib/message-linter.ts`
- `lib/customer-memory.ts`
- `lib/ab-testing.ts`
- `app/api/cron/followup-pre-quote/route.ts`
- `app/api/cron/followup-post-quote/route.ts`
- `app/api/cron/retargeting-drip/route.ts`
- `app/api/cron/outreach-audit/route.ts`
- `app/(dashboard)/railway/page.tsx`
- `app/(dashboard)/retargeting-queue/page.tsx` (Loom/voice note queue)
- `app/(dashboard)/ab-results/page.tsx`
- `scripts/NN-add-lifecycle-state-column.sql`
- `scripts/NN-add-voice-profile-customer-memory.sql`
- `scripts/NN-add-message-templates-ab.sql`
- `scripts/NN-add-outreach-audit-reports.sql`
- `__tests__/outreach-gate.test.ts`
- `__tests__/lifecycle-state.test.ts`
- `__tests__/pipeline-a.test.ts`
- `__tests__/pipeline-b.test.ts`
- `__tests__/pipeline-c.test.ts`
- `__tests__/message-linter.test.ts`
- `__tests__/ab-testing.test.ts`
- `__tests__/railway-e2e.test.ts`

### Update (and freeze)
- `vercel.json` (register new crons, confirm old 5 stay removed)
- `process-scheduled-tasks/route.ts` (drop dead handlers)
- `has-confirmed-booking.ts` (include `pending`, `quoted` in skip statuses)
- Webhooks/action routes that change state → call `transitionState()`
- `.claude/hooks/route-check.sh` → add frozen-paths check

---

## 13. Test + Verification Plan

### 13.1 Unit tests (Vitest)
- Gate: one test per exclusion rule + one per allowed state
- State machine: every transition tested, invalid transitions rejected
- Linter: banned phrases rejected, callback required for Pipeline C, placeholder check, length check
- Message generator: voice profile applied, customer memory referenced

### 13.2 Integration tests
- Seed DB with 10 customers per state, run each pipeline, assert send counts
- Verify A/B split is 50/50 within 5% margin
- Verify circuit breakers trip at threshold

### 13.3 End-to-end railway test
Simulate a customer's full journey:
- form submitted → `new_lead`
- AI replies → `engaged`
- Pipeline A stages fire until quote arrives OR graduation
- quote sent → `quoted`
- Pipeline B stages fire until booking OR graduation
- job scheduled → `scheduled` → `in_service` → `awaiting_payment` → `paid`
- 30 days no rebook → `retargeting`
- Pipeline C fires monthly
- customer replies → `engaged`
- membership created → `recurring`
- membership cancelled → `retargeting`
- opt-out → `archived`

Every transition logged + asserted.

### 13.4 Dry-run smoke test
After deploy to staging: run all crons in dry-run for 24h, inspect 50 generated messages manually. Grade each as: pass / borderline / fail. Target ≥ 90% pass before real-send enable.

### 13.5 Production smoke (Stage 2)
First 7 days of real sends on Spotless only. Daily review:
- 10 random generated messages graded
- Audit report reviewed
- Circuit breaker status reviewed
- Reply / book rate logged

---

## 14. Freeze Mechanism

### 14.1 Frozen files
All files in the Create + Update lists above join the freeze list. Lock applies after Stage 5.

### 14.2 Hook enforcement
`.claude/hooks/route-check.sh` gains a check: if the file being edited is in `frozen-paths.txt` AND `RETARGETING_UNFROZEN` env is not set, block the edit with message:

> "This file is part of the frozen retargeting spec. To edit: (1) confirm with Dominic in session, (2) `export RETARGETING_UNFROZEN=1`, (3) update the Change Log in the plan doc, (4) retry."

### 14.3 Unfreeze requires 4 things
1. Dominic explicit verbal confirmation in session
2. `RETARGETING_UNFROZEN=1` env set
3. Change Log entry in this plan file describing what + why
4. Tests still green after change

---

## 15. Acceptance Checklist (ALL must be green before Stage 2 live send)

- [ ] Kill switch works end-to-end (test it by setting env and hitting every cron)
- [ ] Gate unit tests 100% pass
- [ ] Linter blocks every banned phrase
- [ ] Railway end-to-end test passes all 11 transitions
- [ ] Dry-run on Spotless for 48h with zero audit-critical events
- [ ] 50 generated messages manually reviewed, ≥ 90% pass grade
- [ ] Per-pipeline kill switches tested individually
- [ ] Per-tenant enable flag respected
- [ ] A/B split within 5% of 50/50 on seeded test data
- [ ] Circuit breakers trip at threshold on test fixtures
- [ ] Nightly audit cron runs clean against current DB state
- [ ] `has-confirmed-booking.ts` now catches `pending` + `quoted`
- [ ] Shadow-mode comparison shows no legitimate sends dropped vs old system
- [ ] Rollback plan rehearsed (see Section 16)
- [ ] Voice profile reverse-engineered and Dominic-approved for Spotless, WN, Cedar
- [ ] Voice profile samples for each tenant reviewed: tone matches owner

---

## 16. Rollback Plan

If anything breaks during staged rollout:

1. **Instant stop**: set `RETARGETING_DISABLED=true` (kill switch) → zero sends within 60 seconds
2. **Pipeline-specific stop**: set `PIPELINE_A/B/C_DISABLED=true` → only affected pipeline stops
3. **Per-tenant stop**: flip `tenants.workflow_config.outreach_enabled=false`
4. **Revert code**: `git revert` the Stage N commit; redeploy to main
5. **Cancel queued tasks**: same script used 2026-04-22 (cancels all pending retargeting-type scheduled_tasks)
6. **Postmortem**: log to `docs/postmortems/` with root cause + prevention

---

## 17. Change Log

All future changes to this spec get an entry here.

| Date | Change | Reason | Approved by |
|------|--------|--------|-------------|
| 2026-04-22 | Initial freeze — v1.0 | Phase 2 redesign after 2026-04-22 West Niagara audit | Dominic |
| 2026-04-23 | Universal 30-min active-conversation gate added to all 3 pipelines; legacy post-quote stage-1 10-min skip superseded. | Dominic flagged that follow-ups could fire mid-convo when customer is actively texting. | Dominic |

---

## Open items (do NOT block the build — start here after rollout)

These are explicit deferrals. Not required for v1.0 but listed so they aren't forgotten:

1. **Voice profile dictation vs reverse-engineer**: default is reverse-engineer from 20 real chats, Dominic-approved before enabling per tenant.
2. **MMS frequency**: start at 1-in-5, scale to 1-in-3 after Stage 3.
3. **Loom / voice note queue**: build in Stage 2, enable in Stage 3.
4. **Custom memes**: require Dominic-approval queue for first 6 months of live use.
5. **Banned phrase additions**: Dominic can append to `never_says` per-tenant any time via dashboard.

---

## Sign-off

This spec is the source of truth for Osiris house-cleaning customer outreach as of 2026-04-22. All subsequent code must conform to it. Deviations require the unfreeze process in Section 14.
