# Osiris Platform — System Map

> Source-of-truth map of every tenant, every user role, every workflow, and
> every documented edge case. Used to derive the E2E test journey list in
> `docs/E2E-JOURNEYS.md`.
>
> **Last updated:** 2026-04-28
> **Owner:** Dominic Lutz
> **Drift policy:** if you change tenant config, role gating, lifecycle
> states, or pricing rules, update this doc in the SAME PR.

---

## 1. Tenants

| Slug | Service | App | Owner | Currency | Notes |
|---|---|---|---|---|---|
| `winbros` | Window cleaning | `osiris-window-washing` | Max Shoemaker | USD | Morton, IL. Active redesign 2026-04. Full sales→appt→job lifecycle. |
| `spotless-scrubbers` | House cleaning | `osiris-house-cleaning` | Dominic Lutz | USD | LA. Test dummy for AI experiments. |
| `cedar-rapids` | House cleaning | `osiris-house-cleaning` | Caleb | USD | Cedar Rapids, IA. Near-clone of Spotless workflow. |
| `west-niagara` | House cleaning | `osiris-house-cleaning` | TJ | **CAD** | Ontario. Currency isolation matters. |
| `texas-nova` | House cleaning | `osiris-house-cleaning` | — | USD | Onboarded recently; website lead form bypassed by Zadapt 502 (incident). |

**Cross-tenant invariants (must hold for every test):**
- `tenant_id` filter on every query. Cross-tenant read MUST 404.
- Currency render comes from `formatTenantCurrency(tenant)` — no global default.
- API keys / webhook secrets / phone numbers are per-tenant. Sharing leaks brand.
- WinBros is **excluded** from the HC retargeting / re-engagement / monthly-followup crons (`feedback_winbros_no_retargeting.md`).

---

## 2. Roles

### 2.1 House cleaning (Spotless / Cedar / West Niagara / Texas Nova)

| Role | Auth | Sidebar | Notes |
|---|---|---|---|
| Owner / Admin | username + password (`users` row) | Full nav (Customers, Pipeline, Calendar, Cleaners, Payroll, Insights, Control Center) | One per tenant. |
| Cleaner | portal_token magic-link → `/api/auth/portal-exchange` mints session | Crew portal `/crew/<token>` (legacy) + dashboard pages for newer features | Receives broadcast SMS, accepts via portal. |
| Customer | none — public quote/tip URLs | `/quote/<token>`, `/tip/<token>` | No login. |

### 2.2 Window washing (WinBros)

| Role | Auth | Sidebar | Notes |
|---|---|---|---|
| Owner / Admin | username + password | 13-tab admin nav (Command Center → Control Center) | Max + dual `winbros` login. |
| Team Lead | portal_token → session | Field base + Payroll + Team Performance | Runs a crew on assigned days. `is_team_lead = true` on cleaners. |
| Salesman | portal_token → session | Salesman portal: Command Center, **My Pipeline**, **Team Schedules**, My Customers, Customers, Off Days | Phase H. `employee_type = 'salesman'`. Hybrid TL+salesman → TL nav wins. |
| Technician | portal_token → session | Field base: Command Center, Calendar, Scheduling, My Customers, Customers, Off Days | `employee_type = 'technician'`, `is_team_lead = false`. |
| Customer | none | `/quote/<token>` (read-only), `/tip/<token>` | Same as HC. |

**Role precedence in `selectNavigation`**: `admin > team_lead > salesman > technician`.

---

## 3. Lifecycles

### 3.1 House cleaning lifecycle

```
LEAD INTAKE
  ├─ VAPI inbound call → /api/vapi/post-call → leads + AI qualification
  ├─ OpenPhone SMS inbound → /api/webhooks/openphone → leads/customers
  ├─ HousecallPro webhook → /api/webhooks/housecall-pro
  ├─ GHL webhook → /api/webhooks/ghl
  ├─ Meta lead form → /api/webhooks/meta → leads
  ├─ Website form → /api/webhooks/website/<slug> → leads
  └─ Manual admin entry

LEAD STATUS: new → contacted → qualified → quoted → booked → assigned

QUOTE
  ├─ AI builds quote from VAPI/SMS context
  ├─ Admin builds via QuoteBuilder
  ├─ Customer views /quote/<token>
  ├─ Stripe SetupIntent (card on file, NO deposit)
  └─ Customer accepts → quote.status = 'accepted'

JOB
  ├─ created from accepted quote
  ├─ status: pending → scheduled → broadcast → assigned → in_progress
  │         → completed → closed → paid
  ├─ BROADCAST: SMS sent to all eligible cleaners
  │   └─ first to accept gets it (cleaner_assignments.status = 'accepted')
  ├─ tier-based pricing (TIER_INCLUDED_ADDONS, custom_base_price overrides)
  └─ recurring → service_plan_jobs auto-create

VISIT EXECUTION
  ├─ on_my_way → in_progress → checklist → payment_collected → closed
  └─ Stripe charge happens at "closed" (charge from card-on-file)

POST-JOB
  ├─ receipt + review-link auto-SMS on close
  ├─ tip URL → /tip/<token>
  └─ retargeting/re-engagement crons (NOT for WinBros)
```

### 3.2 Window washing lifecycle (WinBros — current state 2026-04-28)

```
LEAD INTAKE (manual + VAPI; Jack handles outreach himself)
  └─ Customer phone in → leads + customers row

APPOINTMENT (NEW — Phase F unique to WinBros)
  ├─ Stored as a JOB row with status='pending' + crew_salesman_id set
  │  (no separate appointments table)
  ├─ /appointments page: salesman drag-drops appointment onto a slot
  ├─ price field captures the appointment's quoted dollar amount
  └─ ON INSERT/UPDATE with crew_salesman_id + price>0:
     salesman_appointment_credits row inserted with status='pending',
     amount = 12.5% × price

QUOTE (post-appointment)
  ├─ Salesman opens quote from their appointment → /api/crew/.../quote-draft
  │  with appointment_job_id → quote.appointment_job_id linked
  │  Phase I: salesman_id auto-pulled from appointment.crew_salesman_id
  │  DB CHECK: quotes_appointment_needs_salesman blocks any orphan
  ├─ QuoteBuilder: line items + plans + service-book picker
  ├─ Phase D: line item prices click-to-edit on the visit screen
  └─ status: pending → sent → accepted → converted

JOB (post-quote conversion)
  ├─ NEW jobs row created from quote (different row than the appt job)
  ├─ Phase F settle: if quote.appointment_job_id set, flip credit
  │  pending→earned with amount_earned = price × frozen 12.5%
  ├─ Crew assignment: admin drags onto Team Lead in /schedule
  │  (cleaner_id = the team lead's id, not a separate team_lead_id col)
  └─ status: pending → scheduled → in_progress → completed → closed

VISIT EXECUTION (technician portal /my-day)
  ├─ JobDetailDrawer state machine:
  │  not_started → on_my_way → in_progress → stopped → completed
  │  → checklist_done → payment_collected → closed
  ├─ Phase D: every original-quote AND upsell line price click-to-edit
  │  (PATCH /api/actions/visits/line-item; blocked at status='closed')
  ├─ Phase D: Send Invoice / Send Review Link / Text Customer buttons
  └─ Closing → auto-sends receipt + review-request + thank-you

SERVICE PLANS (recurring)
  └─ service_plan_jobs auto-generated per plan recurrence
     (currently 5 plan types in code; Phase E will replace with 3 fixed)

PAYROLL
  ├─ Tech: hourly XOR percentage (frozen weekly)
  ├─ Salesman: 3 commission buckets (1time, triannual, quarterly) on
  │  original_quote revenue
  └─ Phase F: appointment_set commission (12.5% earned credits) added
     to total_pay; settled credits stamped with payroll_week_id
```

### 3.3 Time-off / Day-off (both stacks)

```
WORKER REQUESTS
  └─ /my-schedule: must be ≥14 days out (MINIMUM_ADVANCE_DAYS)
     POST /api/actions/time-off → status='pending'

ADMIN APPROVAL (Phase A — WinBros only so far)
  └─ /my-schedule (admin view) → Approve / Deny (denial requires reason)
     PATCH /api/actions/time-off/decision
     status flips: pending → approved | denied

WORKER SEES RESULT
  └─ /my-schedule worker view: count chips (X OFF / Y PENDING / Z DENIED)
     denied date can be re-requested (upsert resets to pending)
```

---

## 4. User journeys (every persona × every workflow)

### 4.1 WinBros — Admin / Owner

| # | Journey | Critical assertions |
|---|---|---|
| 1 | Login → dashboard `/overview` | All 13 admin tabs render, Calendar above Sales Appointments above Technician Scheduling. |
| 2 | View `/customers` | Dedupe + DUP NAME badge per `incident_aj_duplicate_customer`. |
| 3 | View `/quotes` (Pipeline) | Filterable by status. |
| 4 | View `/jobs` (Calendar) | FullCalendar renders. |
| 5 | View `/appointments` (Sales Appointments) | Salesman rows × time slots. Drag-drop assigns crew_salesman_id + date. + New Appointment opens AppointmentSheet (Phase B target). |
| 6 | View `/schedule` (Technician Scheduling) | Drag jobs onto TLs. + New Quote pill opens QuoteBuilderSheet (Phase B). |
| 7 | View `/service-plan-schedule` | Plan jobs by week. |
| 8 | View `/service-plan-hub` | Plan templates (Phase E target). |
| 9 | View `/performance` (Team Performance) | Per-cleaner metrics. |
| 10 | View `/payroll` | Weekly entries; Phase F adds Appt $ column for salesmen. |
| 11 | View `/tech-upsells` | Catalog management. |
| 12 | View `/insights` | Brain insights. |
| 13 | View `/control-center` | Tenant settings, integrations, automations (Phase G target). |
| 14 | Time-off approval queue (Phase A) | Pending requests strip; Approve / Deny round-trips. |
| 15 | New quote from `/jobs` calendar slot | QuoteBuilderSheet opens, no nav. |
| 16 | Patch quote with appointment_job_id but no salesman | 422 from Phase I validator. |
| 17 | Override commission via `credited_salesman_id` on a job | Reflects in payroll. |

### 4.2 WinBros — Salesman

| # | Journey | Critical assertions |
|---|---|---|
| 1 | Land on `/my-day` after portal-exchange | Salesman sidebar (Phase H), pending commission chip from `/api/crew/<token>/commission-summary`. |
| 2 | View `/my-pipeline` (Phase H) | Three columns Leads / Quotes / Jobs. |
| 3 | View `/team-schedules` (Phase H) | 7-day read-only grid. |
| 4 | View `/my-customers` (Phase C) | Customer rows with relation badges; tap → CustomerThreadDrawer. |
| 5 | Create appointment (Phase B/F) | crew_salesman_id stamped, salesman_appointment_credits row pending. |
| 6 | Create quote from own appointment | salesman_id auto-stamped (Phase I). DB CHECK never trips. |
| 7 | Create quote standalone | salesman_id = self (Wave 3i). |
| 8 | Send quote to customer | Quote SMS uses tenant brand. |
| 9 | Schedule a converted job onto a crew | Quote-conversion settles credit pending → earned. |
| 10 | Text a customer from drawer | OpenPhone send + thread re-fetch shows new message attribution. |
| 11 | Request day off ≥14 days | Pending row created; chip shows. |
| 12 | Request day off <14 days | Blocked, "Text Mgr" badge. |
| 13 | Salesman+TL hybrid | TL nav wins (no /my-pipeline). |

### 4.3 WinBros — Team Lead

| # | Journey | Critical assertions |
|---|---|---|
| 1 | Land on `/my-day` | TL nav (field base + Team Performance + Payroll). |
| 2 | View today's crew schedule | Jobs assigned to me as cleaner_id. |
| 3 | Run a job (open JobDetailDrawer) | State machine on_my_way → ... → closed. |
| 4 | Inline-edit a line item price (Phase D) | PATCH succeeds; locked once visit.status='closed'. |
| 5 | Add an upsell during visit | tech_upsell catalog → visit_line_items insert. |
| 6 | Click Send Invoice (Phase D) | /api/actions/send-invoice → SMS to customer. |
| 7 | Click Send Review Link (Phase D) | /api/actions/send-review-link uses tenant google_review_link; 412 if not configured. |
| 8 | Close job | Stripe charge fires from card-on-file; auto-receipt + review SMS. |
| 9 | View `/payroll` for own week | TL pay computed. |
| 10 | Approve a tech's day-off (currently admin-only — TL approval is OUT of scope). | n/a |

### 4.4 WinBros — Technician

| # | Journey | Critical assertions |
|---|---|---|
| 1 | Land on `/my-day` | Field base nav. |
| 2 | View today/tomorrow jobs as cleaner_id | Cards open JobDetailDrawer. |
| 3 | Run a job (passenger to TL) | Sees same drawer flow. |
| 4 | Add an upsell | visit_line_items row tagged `revenue_type='technician_upsell'`. |
| 5 | Phase D: edit own upsell price | PATCH allowed pre-close. |
| 6 | Text current customer | CustomerThreadDrawer composer; "From tech FirstName: " prefix server-side. |
| 7 | Tip URL accessible to customer | n/a (customer side). |

### 4.5 WinBros — Customer (external)

| # | Journey | Critical assertions |
|---|---|---|
| 1 | Receive quote SMS, click `/quote/<token>` | Public route, no auth, tenant-branded. |
| 2 | View quote line items + plan options | Read-only, all amounts visible. |
| 3 | Sign Accept on a quote | Stripe SetupIntent → card on file. quote.status='accepted'. |
| 4 | Decline a quote | quote.status='declined'. |
| 5 | Click a service plan (Phase E target) | Plan accepted → service_plan_jobs auto-create. |
| 6 | Receive day-before reminder SMS | sendReminders cron, business-hours guard. |
| 7 | Receive arrival SMS | "Just got here, starting now". |
| 8 | Receive completion SMS | "All done — invoice + review + thanks". |
| 9 | Pay tip via /tip/<token> | Stripe → cleaner.tips. |
| 10 | Receive review-link branded SMS | Tenant google_review_link, never global default. |

### 4.6 House Cleaning — Owner / Admin (per tenant)

| # | Journey |
|---|---|
| 1 | Login per tenant slug (cleanmachine.live works for all HC). |
| 2 | View customers + DUP NAME dedupe. |
| 3 | Run pricing tier override (no auto-correct on booked jobs per `feedback_pricing_anchor_strategy`). |
| 4 | Manage cleaners (Telegram-deprecated; SMS-only via OpenPhone). |
| 5 | Manual broadcast assign / unassign. |
| 6 | Review + adjust payroll (tech hourly XOR percentage). |
| 7 | Edit `workflow_config` JSONB (feature flags). |
| 8 | View incidents — webhook health, ghost watchdog. |

### 4.7 House Cleaning — Cleaner

| # | Journey |
|---|---|
| 1 | Receive broadcast SMS with portal link. |
| 2 | Click portal link → portal-exchange → session. |
| 3 | Accept/decline via portal (NEVER reply YES/NO per `feedback_cleaner_sms_portal`). |
| 4 | View today's jobs in `/crew/<token>` (legacy) or `/my-day` (new). |
| 5 | See "Your pay: $XXX" — NEVER the customer price (per `feedback_cleaner_price_hidden`). |
| 6 | Run job → on_my_way → in_progress → completed → closed. |
| 7 | Mark payment collected (Stripe charges card on file). |
| 8 | Tip surfaced post-close. |

### 4.8 House Cleaning — Customer (per tenant)

| # | Journey |
|---|---|
| 1 | VAPI call → AI qualifies → quote SMS. |
| 2 | Web form on tenant landing page (`/offer`, `/airbnb`, `/commercial`, `/promo`). |
| 3 | Meta ad click → landing page → form. Pixel must fire (`incident_meta_pixel_missing`). |
| 4 | View `/quote/<token>` with correct currency (USD or CAD per tenant). |
| 5 | Card-on-file SetupIntent. |
| 6 | Day-before reminder SMS. |
| 7 | Cleaner ETA SMS. |
| 8 | Closing receipt + review link. |
| 9 | Tip URL. |
| 10 | $99 / $149 promo deep-dilution (Spotless only — only 4 addons, NEVER fridge/oven/baseboards per `feedback_149_diluted_deep`). |

---

## 5. Edge cases (every little thing that can go wrong)

Each row needs an E2E test journey or a documented decision to skip.

### 5.1 Lead intake edge cases

| # | Scenario | Expected behavior |
|---|---|---|
| L1 | Same phone hits VAPI + website + Meta within 1 hr | `upsertLeadCustomer` dedupe, single customer row, DUP NAME badge if names differ. |
| L2 | Lead status = new, no contact for 24h | (HC only) cold-followup cron sends SMS. (WinBros excluded.) |
| L3 | Customer says "not interested" via SMS | AI classifies → leads.status = 'lost', no further follow-up. |
| L4 | Customer asks for email | Default is SMS-only (`feedback_email_only_when_asked`). Only send email if explicit. |
| L5 | VAPI hands off to human | Manual takeover task created; 10-min cooldown (`feedback_ghosting_prevention`). |
| L6 | Manual customer flagged (Raza, Mahas, Ami Bells) | NEVER auto-text (`feedback_manual_customers`). |
| L7 | Phone number changes mid-conversation | `customers.phone_number` update + thread merge. |
| L8 | Duplicate webhook delivery | Idempotency via `stripe_processed_events` / message dedup. |
| L9 | Webhook secret drift | Tenant resolution fails fast → no processing (`incident_webhook_drift_recurrence`). |
| L10 | Lead arrives outside business hours | sendSMS throttle 3/day + business-hours guard. |

### 5.2 Quote edge cases

| # | Scenario | Expected behavior |
|---|---|---|
| Q1 | Customer never opens quote URL | follow-up-quoted cron (HC) sends nudge; WinBros excluded. |
| Q2 | Customer accepts then asks for price change | New quote row, old archived. |
| Q3 | Quote builder shows "quoteId and approvedBy required" on premature Approve (known side bug). | Logged; not gating. |
| Q4 | Quote with tier override + custom_base_price | TIER_INCLUDED_ADDONS still applies; cleaner_pay_override stored. |
| Q5 | Promo quote ($99/$149) | normal_price stored in notes, cleaner paid 50% of normal not 50% of $99 (`feedback_promo_cleaner_pay`). |
| Q6 | Quote currency vs tenant currency | Always tenant; CAD for WN, USD for others. |
| Q7 | Phase I: appointment_job_id set, salesman cleared | 422 from validator; DB CHECK is backstop. |
| Q8 | West Niagara overquote (e.g., ReG C$600 vs C$480) | Don't auto-correct; flag for owner (`feedback_pricing_anchor_strategy`). |
| Q9 | Customer signs SetupIntent on quote, card declined later | Job stays unbooked; manual_takeover. |

### 5.3 Job / scheduling edge cases

| # | Scenario | Expected behavior |
|---|---|---|
| J1 | Customer reschedules >24h before | Update jobs.date, re-broadcast. |
| J2 | Customer reschedules <24h before | Late-reschedule fee or manual handle (per tenant policy). |
| J3 | Customer no-shows | Job marked no-show; cleaner travel pay if applicable. |
| J4 | Cleaner declines broadcast | Broadcast continues; ghost-watchdog cron auto-reassigns. |
| J5 | All cleaners decline | Admin alert; manual reassign. |
| J6 | Cleaner ghosts after accept | Watchdog cron flags; admin reassigns. |
| J7 | Weather cancellation (window cleaning) | Reschedule modal in WinBros. |
| J8 | Wrong job address | Address edit + customer notification. |
| J9 | Job runs over time | Cleaner can mark "stopped" + resume; payroll respects time entries. |
| J10 | Duplicate broadcast (rapid SQL replay) | RPC `FOR UPDATE SKIP LOCKED` claims one row. |
| J11 | Future-job guard | Don't allow status='completed' on a future date. |
| J12 | Cross-tenant job read | 404 even if cleaner is in another tenant. |
| J13 | Free re-clean | Job created with $0 price + customer notes; doesn't double-pay cleaner. |
| J14 | WinBros job assigned to non-team-lead cleaner | App layer warns; no DB constraint (HC has 307 broadcast jobs without cleaner_id). |

### 5.4 Visit execution edge cases (WinBros + HC)

| # | Scenario | Expected behavior |
|---|---|---|
| V1 | Tech adds upsell mid-visit | visit_line_items insert; total updates. |
| V2 | Tech edits upsell price (Phase D) | PATCH allowed, blocked at status='closed'. |
| V3 | Customer wants discount after close | Manual refund flow; visit immutable. |
| V4 | Stripe charge fails on close | Visit marked payment_failed; admin notified. |
| V5 | Card not on file at close | `feedback_payment_flow`: NO deposits; admin must add card. |
| V6 | Tip changes after closure | Separate /tip/<token> flow; doesn't mutate visit. |
| V7 | Refund / dispute | Stripe webhook → visit/jobs annotation. |
| V8 | Cleaner forgets to mark done; auto-close | post-job-followup cron flags; admin closes manually. |
| V9 | Multi-tech visit | technicians[] tracked; each gets their own pay row. |

### 5.5 Payment / Pricing edge cases

| # | Scenario | Expected behavior |
|---|---|---|
| P1 | Currency render on a CAD quote viewed by USD-locale browser | `formatTenantCurrency(tenant)` is source of truth. |
| P2 | Tier override + addon | TIER_INCLUDED_ADDONS unchanged; addon adds incremental. |
| P3 | $99 promo + $X tip + $Y upsell | cleaner_pay = 50% × normal_price (not promo); tip 100% to cleaner. |
| P4 | Discount label vs actual price | original_price field is anchor; total_price is what customer pays. |
| P5 | Stripe card-on-file expires | Payment fails on close; admin alert. |
| P6 | Refund fully | jobs.status → refunded; payroll back-out. |

### 5.6 Recurring / Service plan edge cases

| # | Scenario | Expected behavior |
|---|---|---|
| R1 | Customer skips one occurrence | service_plan_jobs[i].status='skipped'; next plan job stays scheduled. |
| R2 | Customer cancels plan | All future plan_jobs cancelled. |
| R3 | Plan price changes mid-cycle | Existing scheduled plan_jobs keep frozen price; new ones use new price. |
| R4 | Plan auto-priced off exterior windows line (Phase E) | formula × line_item; locked unless admin overrides. |
| R5 | Plan agreement signature on customer view (Phase E) | Captured; quote.terms[] includes signed checksum. |

### 5.7 Multi-tenant boundary edge cases

| # | Scenario | Expected behavior |
|---|---|---|
| T1 | Cleaner of tenant A logs in, requests tenant B job | 404. |
| T2 | Webhook with tenant A phone number lands in tenant B | Tenant resolution by secret matching, not blind .find(). |
| T3 | Cross-tenant SMS template default | `feedback_fail_closed_multitenant`: never fall back to global env. |
| T4 | tenants.workflow_config feature flag missing | `tenantUsesFeature(tenant, name)` returns false safely. |
| T5 | RLS bypass attempt | Service client only used in webhooks/crons; dashboard reads use scoped client. |

### 5.8 Auth / session edge cases

| # | Scenario | Expected behavior |
|---|---|---|
| A1 | SMS magic-link `/api/auth/portal-exchange` (FIXED 2026-04-28) | Whitelisted in publicRoutes; 307 redirect. |
| A2 | Cleaner session hits admin-only route | Currently 500 (bug, separate ticket); should be 403. Security guarantee: DB row unchanged. |
| A3 | Session expired | 401 + redirect to /login. |
| A4 | Session for cleaner of tenant A used on tenant B URL | Cross-tenant 404. |
| A5 | Bearer token from mobile app | Same as cookie session (Auth header). |

### 5.9 Automation / cron edge cases

| # | Scenario | Expected behavior |
|---|---|---|
| C1 | Cron runs with backlog of old records | Backfill protection; no rapid-fire (`feedback_cron_safety`). |
| C2 | Customer-facing cron during off-hours | Business-hours guard. |
| C3 | sendSMS throttle (3/day per customer) | Skipped + logged. |
| C4 | Cron template change (Phase G target) | Read from automation_templates table; 60s cache. |
| C5 | WinBros included in HC retargeting cron | Block by tenant slug check (`feedback_winbros_no_retargeting`). |

---

## 6. Coverage matrix → E2E test journey doc

This map is the input to `docs/E2E-JOURNEYS.md`. Each row in sections 4 + 5
should map to a Playwright spec or have a documented "skip with reason."

**Coverage thresholds:**
- Tier 1 (must have before next push): Auth, time-off approval, line-item PATCH, quote-link guard, salesman portal, broadcast assign, payment close.
- Tier 2 (must have for round-2 production cutover): all journeys in sections 4.1–4.5, plus L1, Q1, Q7, J1–J6, V1–V4, P1–P3, T1–T2, A1–A4, C5.
- Tier 3 (nice to have): plan + agreement (Phase E), automations admin (Phase G).
