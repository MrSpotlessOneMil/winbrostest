# Membership Feature — Handoff Document

## Overview

Implementing full membership lifecycle for the Osiris multi-tenant SaaS platform (cleaning businesses). Memberships are "discount trackers" — the tenant manually creates jobs and links them to a membership. The system tracks visit counts, applies discounts, and handles auto-renewal via SMS.

## 8-Step Implementation Plan

| Step | Description | Status |
|------|-------------|--------|
| 1 | DB Migration (delta ALTERs to existing tables) | ✅ Complete |
| 2 | Fix bugs in quote approval + membership CRUD routes | ✅ Complete |
| 3 | Job Completion → Membership Lifecycle | ✅ Complete |
| 4 | Remove Dead Code (cron, approve-visit route) | ❌ Not started |
| 5 | Calendar Membership Selector (replace frequency dropdown) | ❌ Not started |
| 6 | Quote Page Fixes (dynamic plans, addon quantities, tenant-aware branding) | ❌ Not started |
| 7 | Membership Dashboard Page | ❌ Not started |
| 8 | Tests | ❌ Not started |

---

## Key Design Decisions

- **No early cancellation fees** for memberships
- **Service plans fetched dynamically from Supabase** (not hardcoded)
- **Repurpose calendar's "frequency" dropdown** to be a membership selector for WinBros
- **Tenant decides when to schedule membership cleanings** (no auto-scheduling cron)
- **Kill the `schedule-membership-visits` cron** entirely (Step 4)
- **Tenant-aware public quote page** — pull branding from tenant record, not hardcoded "WinBros"
- **Auto-renewal SMS flow**: on penultimate visit completion, text customer asking RENEW/CANCEL; on final visit, act on their response
- **Single-visit plans** (`visits_per_year = 1`) auto-complete without renewal SMS — by design, no penultimate visit exists

---

## Completed Work Details

### Step 1 — DB Migration (`scripts/08-memberships-and-quotes.sql`)

Applied to live Supabase (project: `kcmbwstjmdrjkhxhkkjt`). All verified with 9 DB tests.

Changes:
- Added `renewal_choice TEXT` and `renewal_asked_at TIMESTAMPTZ` columns to `customer_memberships`
- Updated `customer_memberships` status CHECK to include `'completed'`
- Updated `jobs` status CHECK to include `'quoted'`
- Dropped `early_cancel_repay` from `service_plans`
- Dropped `credits` and `stripe_subscription_id` from `customer_memberships`

### Step 2 — Bug Fixes in Existing Routes

**`app/api/quotes/[token]/route.ts`** (PATCH handler):
- `addMonths()` helper for safe month addition (Jan 31 + 1 month = Feb 28)
- try-catch on `request.json()`
- Addon normalization: supports both `string[]` and `{key, quantity}[]` formats
- Null/invalid addon filtering, negative quantity prevention (`Math.max(1, Math.floor(...))`)
- Invalid membership plan now returns 400 (was silently ignored)
- `membership_plan` type-validated as string before DB query
- Membership insert captures returned ID via `.select("id").single()`
- Duplicate membership guard before insert
- Job insert receives `membership_id` from created/existing membership

**`app/api/actions/memberships/route.ts`**:
- `addMonths()` helper added
- POST: try-catch on request.json(), `plan_slug` type validated, removed `credits: 0` from insert
- PATCH: try-catch on request.json(), removed `early_cancel_repay` logic, cancel blocked from `completed` state
- Resume recalculates `next_visit_at` if in the past

### Step 3 — Job Completion → Membership Lifecycle

**`app/api/actions/complete-job/route.ts`** — `handleMembershipLifecycle()` function:
- Called after every membership-linked job completes (all 3 payment paths: prepaid, auto-charge, payment link)
- **Every visit**: increments `visits_completed`, advances `next_visit_at` by `interval_months`
- **Penultimate visit** (`visits_completed === visits_per_year - 1`): sets `renewal_asked_at` in DB, then sends renewal SMS ("Reply RENEW or CANCEL"), notifies tenant via Telegram
- **Final visit** (`visits_completed >= visits_per_year`):
  - `renewal_choice === 'renew'`: resets `visits_completed` to 0, clears renewal fields, notifies tenant
  - Otherwise (cancel or no response): marks membership `completed`, notifies customer + tenant
- **Race condition protection**: optimistic lock via `WHERE visits_completed = <prev_value>` — if concurrent update, logs warning and returns (no phantom notifications)
- **Notifications fire only after successful DB update** — prevents phantom SMS on optimistic lock failure
- Helper: `getCustomerName()` with tenant_id scoping for cross-tenant isolation

**`app/api/webhooks/openphone/route.ts`** — Renewal reply handler:
- Inserted after message storage, before AI intent analysis
- Only matches exact `RENEW` or `CANCEL` keywords (not YES/NO — avoids false positives with booking conversations)
- Checks for active membership with `renewal_asked_at IS NOT NULL` and `renewal_choice IS NULL`
- Records choice atomically (`WHERE renewal_choice IS NULL`), verifies row was actually updated (checks `updatedRows.length > 0`) to prevent duplicate confirmations
- Sends confirmation SMS to customer, Telegram notification to tenant
- Returns early — skips AI auto-response flow

**`lib/system-events.ts`** — 5 new event types:
- `MEMBERSHIP_RENEWAL_ASKED`, `MEMBERSHIP_RENEWED`, `MEMBERSHIP_COMPLETED`
- `MEMBERSHIP_RENEWAL_CONFIRMED`, `MEMBERSHIP_RENEWAL_DECLINED`

**`lib/supabase.ts`** — Added `membership_id?: string` to `Job` interface

---

## Remaining Steps — Implementation Notes

### Step 4 — Remove Dead Code

Delete these files:
- `app/api/cron/schedule-membership-visits/route.ts` — auto-scheduling cron (replaced by manual scheduling)
- `app/api/actions/memberships/approve-visit/route.ts` — visit approval (no longer needed)

Also:
- Remove the cron entry from `vercel.json` (search for `schedule-membership-visits`)
- Check for any imports or references to these files and remove them

### Step 5 — Calendar Membership Selector

**File**: `app/(dashboard)/jobs/page.tsx`

Replace the "frequency" dropdown with a membership selector for WinBros. When creating/editing a job in the calendar:
- Fetch active memberships for the selected customer from `customer_memberships` (with plan details)
- Show dropdown: "No membership" + list of active memberships (e.g. "Monthly Plan — 3/12 visits")
- When a membership is selected, set `membership_id` on the job and auto-apply the plan's `discount_per_visit`
- The frequency field may still be needed for non-WinBros tenants (Cedar Rapids, Spotless Scrubbers) — make it conditional via `workflow_config`

### Step 6 — Quote Page Fixes

**File**: `app/quote/[token]/page.tsx`

Current issues:
- `MEMBERSHIP_PLANS` array is hardcoded in the component — should come from `service_plans` table via the quote API
- "WinBros" is hardcoded in the page title and branding — should use tenant's `business_name` from the quote record
- Addon quantity UI exists but needs verification with the normalized `{key, quantity}` format

Changes needed:
- Quote API (`app/api/quotes/[token]/route.ts` GET handler) should return `service_plans` for the quote's tenant
- Quote page should render plans from API response, not hardcoded array
- Replace all hardcoded "WinBros" with tenant name from quote data
- Verify addon quantity selectors work end-to-end with the normalized format

### Step 7 — Membership Dashboard Page

New page: `app/(dashboard)/memberships/page.tsx`

Should show:
- Table of all memberships for the tenant (with customer name, plan, status, visits completed, next visit date)
- Filters: status (active/paused/cancelled/completed)
- Actions: pause, resume, cancel (using existing PATCH endpoint at `app/api/actions/memberships/route.ts`)
- Create new membership button (using existing POST endpoint)
- Show renewal status for memberships with pending renewal questions

### Step 8 — Tests

Write 2-3 Vitest tests covering:
- Happy path: job completion increments visits_completed, advances next_visit_at
- Penultimate visit triggers renewal SMS
- Final visit with renewal_choice='renew' resets membership
- Final visit with no renewal_choice completes membership
- Cross-tenant rejection (assert 404)
- OpenPhone webhook: RENEW reply records choice, CANCEL reply records choice
- Race condition: concurrent update is safely rejected

---

## Important Technical Details

### Supabase Project
- Project ID: `kcmbwstjmdrjkhxhkkjt` (winbrostest)
- Tables involved: `customer_memberships`, `service_plans`, `jobs`, `quotes`, `customers`

### Key Patterns
- **`addMonths()` helper** — duplicated in 3 files (quotes route, memberships route, complete-job route). Consider extracting to `lib/date-utils.ts` if desired.
- **Optimistic locking** — membership updates use `WHERE visits_completed = <prev_value>` to prevent concurrent corruption
- **Atomic transitions** — status updates use `WHERE status = 'active'` to prevent double-processing
- **Notification ordering** — all SMS/Telegram/events fire ONLY after the DB update succeeds

### Pre-existing TS Errors (not from membership work)
These exist in the codebase and are NOT regressions:
- `AUTO_CHARGE_SUCCESS` / `AUTO_CHARGE_FAILED` not in `SystemEventType` (complete-job route)
- `customerName` / `jobDate` / `jobTime` undefined (openphone webhook ~line 845)
- `POST_BOOKING_MESSAGE_HANDLED`, `AUTO_RESPONSE_SEND_FAILED`, `AUTO_RESPONSE_SKIPPED`, `AUTO_RESPONSE_ERROR`, `CARD_ON_FILE_TERMS_SENT` not in `SystemEventType`

### Files Modified in Steps 1-3
1. `scripts/08-memberships-and-quotes.sql` — delta migration (applied to live DB)
2. `app/api/quotes/[token]/route.ts` — quote approval PATCH handler
3. `app/api/actions/memberships/route.ts` — membership CRUD
4. `app/api/actions/complete-job/route.ts` — job completion + membership lifecycle
5. `app/api/webhooks/openphone/route.ts` — renewal reply handler
6. `lib/system-events.ts` — new event types
7. `lib/supabase.ts` — Job interface update

### Files to Delete in Step 4
1. `app/api/cron/schedule-membership-visits/route.ts`
2. `app/api/actions/memberships/approve-visit/route.ts`

### Files to Modify in Steps 5-7
1. `app/(dashboard)/jobs/page.tsx` — calendar membership selector
2. `app/quote/[token]/page.tsx` — dynamic plans + tenant branding
3. `app/(dashboard)/memberships/page.tsx` — new membership dashboard page (create)
