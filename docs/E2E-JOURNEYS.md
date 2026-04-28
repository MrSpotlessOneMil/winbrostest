# Osiris E2E Test Journey Catalog

> Derived from `docs/SYSTEM-MAP.md`. One row per Playwright test journey.
> Status legend:
>
> - ✅ passing — spec exists and currently green in pre-push gate
> - 🟡 wip — spec exists but not yet green (or asserts soft)
> - 🔴 todo — no spec yet
> - ⏭ skip — explicit decision to defer, with reason
>
> **Last updated:** 2026-04-28
> **Run all winbros-phase specs:**
>
> ```bash
> WW_BASE_URL=http://localhost:3002 \
>   SUPABASE_SERVICE_ROLE_KEY=... \
>   npx playwright test --project=winbros-phase
> ```

---

## Tier 1 — Must be green before any push to `main`

| # | Map ref | Tenant | Persona | Journey | Spec | Status |
|---|---|---|---|---|---|---|
| T1.1 | 4.1 #14 / Phase A | winbros | admin | Approve a pending time-off request | `winbros-phase-a-time-off-approval.spec.ts` | ✅ |
| T1.2 | 4.1 #14 | winbros | admin | Deny a time-off request requires `denial_reason` | same | ✅ |
| T1.3 | 4.1 #14 | winbros | admin | Deny with reason flips status | same | ✅ |
| T1.4 | 5.8 A2 | winbros | cleaner | Cannot mutate time_off via admin endpoint (DB row stays pending) | same | ✅ |
| T1.5 | 4.4 #5 / Phase D | winbros | tech | Inline-edit upsell price on open visit persists | `winbros-phase-d-line-item-pricing.spec.ts` | ✅ |
| T1.6 | 5.4 V2 / Phase D | winbros | tech | Edit blocked on closed visit (409, DB unchanged) | same | ✅ |
| T1.7 | 5.4 V2 | winbros | tech | Negative price rejected (400) | same | ✅ |
| T1.8 | 5.7 T1 | winbros | tech | 404 on non-existent line item id | same | ✅ |
| T1.9 | 4.2 #2 / Phase H | winbros | salesman | Sidebar shows My Pipeline + Team Schedules and hides tech-only entries | `winbros-phase-h-salesman-portal.spec.ts` | ✅ |
| T1.10 | 4.2 #2 | winbros | salesman | `/my-pipeline` renders three columns | same | ✅ |
| T1.11 | 4.2 #3 | winbros | salesman | `/team-schedules` renders 7-day grid | same | ✅ |
| T1.12 | 4.2 #2 | winbros | salesman | `/api/crew/<token>/pipeline` returns shaped body | same | ✅ |
| T1.13 | 4.2 #2 | winbros | tech | Pipeline endpoint 403s non-salesman | same | ✅ |
| T1.14 | 4.2 #6 / Phase I | winbros | salesman | Crew quote-draft from appointment auto-stamps salesman_id | `winbros-phase-i-quote-link-guard.spec.ts` | ✅ |
| T1.15 | 4.2 #6 / Phase I | winbros | tech | Non-salesman crew draft inherits salesman from appointment | same | ✅ |
| T1.16 | 5.2 Q7 | winbros | (db) | Direct DB insert violating link rule → CHECK 23514 | same | ✅ |
| T1.17 | 5.8 A1 | winbros | tech/salesman | `/api/auth/portal-exchange` is publicly reachable (FIXED) | (smoke via curl in CI) | 🔴 |
| T1.18 | 4.6 #6 | hc-any | admin | Login + currency render matches tenant (USD vs CAD) | `hc-currency-isolation.spec.ts` | 🔴 |
| T1.19 | 5.7 T1 | hc-any | cleaner | Cross-tenant job read returns 404 | `hc-tenant-isolation.spec.ts` | 🔴 |
| T1.20 | 5.4 V4 | hc-any | (system) | Stripe charge failure on close marks visit `payment_failed` | `hc-payment-failure.spec.ts` | 🔴 |

**Current Tier 1 coverage: 16 / 20 ✅**

---

## Tier 2 — Required before round-2 production cutover

### 2A — WinBros admin (section 4.1)

| # | Journey | Spec | Status |
|---|---|---|---|
| T2.1 | Login → 13 admin tabs render in expected order | `winbros-admin-sidebar.spec.ts` | 🔴 |
| T2.2 | `/customers` shows DUP NAME badge for duplicate names | `winbros-admin-customers.spec.ts` | 🔴 |
| T2.3 | `/quotes` Pipeline filterable by status | same | 🔴 |
| T2.4 | `/jobs` FullCalendar renders with this week's jobs | `winbros-admin-calendar.spec.ts` | 🔴 |
| T2.5 | `/appointments` drag-drop assigns crew_salesman_id + creates appointment-set credit | `winbros-admin-appointments.spec.ts` | 🔴 |
| T2.6 | `/schedule` drag job onto TL persists `cleaner_id` + `date` | `winbros-admin-schedule.spec.ts` | 🔴 |
| T2.7 | `+ New Quote` pill on `/schedule` opens QuoteBuilderSheet (no nav) | same | 🔴 |
| T2.8 | `/payroll` weekly entries; salesman row shows Appt $ column | `winbros-admin-payroll.spec.ts` | 🔴 |
| T2.9 | `/payroll` confirms earned credits stamped with payroll_week_id | same | 🔴 |
| T2.10 | Override `credited_salesman_id` on a job re-routes commission | same | 🔴 |
| T2.11 | `/control-center` admin updates `workflow_config` JSONB | `winbros-admin-control-center.spec.ts` | 🔴 |

### 2B — WinBros salesman (section 4.2)

| # | Journey | Spec | Status |
|---|---|---|---|
| T2.12 | Land on `/my-day` shows commission chip from API | `winbros-salesman-my-day.spec.ts` | 🔴 |
| T2.13 | Hybrid TL+salesman → TL nav wins (no /my-pipeline) | `winbros-phase-h-salesman-portal.spec.ts` (extend) | 🔴 |
| T2.14 | Create appointment + PATCH salesman → pending credit row | `winbros-phase-f-commission-lifecycle.spec.ts` | ✅ |
| T2.15 | Convert appointment → quote → job → credit flips to `earned` | same | ✅ |
| T2.16 | Voided appointment (declined / no-show) → credit `voided` | (todo: separate spec) | 🔴 |
| T2.16a | Re-approve already-converted quote is idempotent (credit stays earned, no duplicate) | `winbros-phase-f-commission-lifecycle.spec.ts` | ✅ |
| T2.16b | Appointment with no salesman → no credit (skipped) | same | ✅ |
| T2.16c | Appointment with price=0 → no credit (skipped) | same | ✅ |
| T2.17 | Send quote SMS to customer (mocked OpenPhone) | `winbros-salesman-send-quote.spec.ts` | 🔴 |
| T2.18 | Day-off ≥14 days → row created `pending` | `winbros-time-off-request.spec.ts` | 🔴 |
| T2.19 | Day-off <14 days → blocked, `Text Mgr` badge | same | 🔴 |
| T2.20 | Day-off denied + re-request → upsert resets to `pending` | same | 🔴 |

### 2C — WinBros team lead (section 4.3)

| # | Journey | Spec | Status |
|---|---|---|---|
| T2.21 | TL sidebar = field base + Team Performance + Payroll | `winbros-tl-sidebar.spec.ts` | 🔴 |
| T2.22 | Open JobDetailDrawer → state machine on_my_way → in_progress → completed → closed | `winbros-tl-visit-flow.spec.ts` | 🔴 |
| T2.23 | Add tech upsell mid-visit | same | 🔴 |
| T2.24 | Click Send Invoice button → API call + DB record | `winbros-tl-send-invoice.spec.ts` | 🔴 |
| T2.25 | Click Send Review Link → uses tenant google_review_link, 412 if missing | `winbros-tl-send-review.spec.ts` | 🔴 |
| T2.26 | Click Text Customer → opens drawer; send composer round-trip | `winbros-tl-text-customer.spec.ts` | 🔴 |
| T2.27 | Close job triggers Stripe charge from card-on-file (mocked) + receipt SMS | `winbros-tl-close-job.spec.ts` | 🔴 |

### 2D — WinBros customer (section 4.5)

| # | Journey | Spec | Status |
|---|---|---|---|
| T2.28 | `/quote/<token>` public route renders (no auth) | `winbros-customer-quote.spec.ts` | 🔴 |
| T2.29 | Customer Accept signs SetupIntent (Stripe test mode); status='accepted' | same | 🔴 |
| T2.30 | Customer Decline → status='declined' | same | 🔴 |
| T2.31 | `/tip/<token>` public; tip stored | `winbros-customer-tip.spec.ts` | 🔴 |
| T2.32 | Day-before reminder SMS dry-run (cron) | `winbros-customer-reminder.spec.ts` | 🔴 |

### 2E — Edge cases (section 5)

| # | Map ref | Journey | Spec | Status |
|---|---|---|---|---|
| T2.33 | L1 | Same phone via VAPI + website + Meta dedupes to single customer | `edge-lead-dedupe.spec.ts` | 🔴 |
| T2.34 | L4 | AI never promises email unless customer asks | `edge-lead-email-only-when-asked.spec.ts` | 🔴 |
| T2.35 | L6 | Manual customers (Raza, Mahas, Ami Bells) blocked from auto-text | `edge-lead-manual-customers.spec.ts` | 🔴 |
| T2.36 | L9 | Webhook secret drift fails fast | `edge-webhook-secret-drift.spec.ts` | 🔴 |
| T2.37 | Q5 | $99 promo: cleaner pay computed off normal_price | `edge-promo-cleaner-pay.spec.ts` | 🔴 |
| T2.38 | Q6 | West Niagara quote renders CAD | `edge-currency-cad.spec.ts` | 🔴 |
| T2.39 | J1 | Customer reschedule >24h → re-broadcast | `edge-reschedule-future.spec.ts` | 🔴 |
| T2.40 | J2 | Reschedule <24h → policy enforcement | same | 🔴 |
| T2.41 | J4 | Cleaner declines broadcast → next cleaner offered | `edge-broadcast-decline.spec.ts` | 🔴 |
| T2.42 | J5 | All cleaners decline → admin alert | same | 🔴 |
| T2.43 | J6 | Ghost-watchdog reassigns | same | 🔴 |
| T2.44 | J9 | Cleaner stops + resumes; payroll respects time entries | `edge-stop-resume.spec.ts` | 🔴 |
| T2.45 | J11 | Future-job guard: status='completed' on future date rejected | `edge-future-job-guard.spec.ts` | 🔴 |
| T2.46 | J13 | Free re-clean: $0 price doesn't double-pay cleaner | `edge-free-reclean.spec.ts` | 🔴 |
| T2.47 | V4 | Stripe charge failure on close → payment_failed; admin alert | `edge-stripe-failure.spec.ts` | 🔴 |
| T2.48 | V5 | Card-on-file missing at close → blocked, no deposit fallback | `edge-no-card-on-file.spec.ts` | 🔴 |
| T2.49 | V8 | post-job-followup cron flags forgotten close | `edge-post-job-followup.spec.ts` | 🔴 |
| T2.50 | A4 | Tenant A session on Tenant B URL → 404 | `edge-cross-tenant-session.spec.ts` | 🔴 |
| T2.51 | C2 | Customer-facing cron outside business hours → no SMS | `edge-cron-business-hours.spec.ts` | 🔴 |
| T2.52 | C3 | sendSMS throttle 3/day per customer → 4th skipped | `edge-sms-throttle.spec.ts` | 🔴 |
| T2.53 | C5 | WinBros excluded from HC retargeting cron | `edge-winbros-no-retargeting.spec.ts` | 🔴 |

---

## Tier 3 — Phase E + G + nice-to-haves

| # | Map ref | Journey | Status |
|---|---|---|---|
| T3.1 | Phase E | Service plan template seeds (3 fixed) | 🔴 blocked: plan names |
| T3.2 | Phase E | Plan price = formula × exterior_windows line | 🔴 blocked |
| T3.3 | Phase E | Customer accepts plan → auto-create service_plan_jobs | 🔴 blocked |
| T3.4 | Phase E | Plan agreement signature captured | 🔴 blocked |
| T3.5 | Phase G | automation_templates round-trip via dispatchAutomation | 🔴 needs alignment |
| T3.6 | Phase G | Cron reads template body from DB (60s cache) | 🔴 needs alignment |
| T3.7 | Phase G | Admin UI edits template body, preview renders | 🔴 needs alignment |
| T3.8 | Phase G | RLS: WinBros tenant cannot read HC templates | 🔴 needs alignment |

---

## HC tenants — separate spec sweep (section 4.6–4.8)

| Tenant | Spec file root | Tier 1 | Tier 2 |
|---|---|---|---|
| Spotless Scrubbers | `spotless-*.spec.ts` | currency, broadcast, $149 promo | full lifecycle |
| Cedar Rapids | `cedar-*.spec.ts` | currency, broadcast | full lifecycle |
| West Niagara | `wn-*.spec.ts` | **CAD currency**, broadcast | full lifecycle, ReG anchor |
| Texas Nova | `txnova-*.spec.ts` | currency, website lead form (Zadapt 502 incident) | full lifecycle |

Existing partial coverage: `tests/e2e/spotless-landing-smoke.spec.ts`,
`tests/e2e/spotless-pricing-audit.spec.ts`, `tests/e2e/demo-hc.spec.ts`,
`tests/e2e/leads.spec.ts`, `tests/e2e/quote-tiers-qa.spec.ts`. Many run
against prod (`cleanmachine.live`); the new sweep should run locally.

---

## Coverage targets

| Tier | Target | Current | Gap |
|---|---|---|---|
| 1 | 20 / 20 ✅ | 16 / 20 ✅ | 4 specs (T1.17–20) |
| 2 | 56 / 56 | 4 / 56 ✅ | 52 specs (Phase F lifecycle done) |
| 3 | 8 / 8 | 0 / 8 | 8 specs (mostly blocked) |
| HC sweep | per-tenant lifecycle | partial smoke only | full sweep |

**Total winbros-phase E2E: 21 tests passing.**

**Pre-push gate stays at the unit level (200 tests) until Tier 1 + Tier 2A
hit green. The winbros-phase project covers the round-2 work in `main`.**
