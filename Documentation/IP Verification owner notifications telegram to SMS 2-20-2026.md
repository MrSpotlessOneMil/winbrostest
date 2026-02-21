# Fix: Owner Notifications — Telegram to SMS via OpenPhone

**Fix Date:** 2026-02-20
**Severity:** Low (feature change, not a bug)
**Outcome:** All 8 owner notifications now send SMS via OpenPhone instead of Telegram

---

## Problem

Owner notifications (payment failures, new bookings, dispatch summaries, weather alerts, etc.) were sent via Telegram using `sendTelegramMessage()`. The team decided the owner should receive these as SMS text messages to their phone via OpenPhone instead.

All 8 notifications used:
- HTML formatting (`<b>` tags) — not supported by SMS
- `tenant.owner_telegram_chat_id` as the guard/recipient
- `sendTelegramMessage(tenant, tenant.owner_telegram_chat_id, msg, 'HTML')` to send

---

## Fix

Converted all 8 owner Telegram notifications to use `sendSMS(tenant, tenant.owner_phone, msg)` from `lib/openphone.ts`.

### Changes applied to each notification:
1. Guard: `tenant.owner_telegram_chat_id` → `tenant.owner_phone`
2. Send: `sendTelegramMessage(...)` → `sendSMS(tenant, tenant.owner_phone, ...)`
3. Format: HTML `<b>` tags → UPPERCASE, `⚠️` → `WARNING:`, em dashes (`—`) → regular dashes (`-`)

---

## Files Changed

| File | Notifications Changed | Import Changes |
|------|----------------------|----------------|
| `app/api/webhooks/stripe/route.ts` | 3 (Payment Failed, New Booking Card on File, Lead Fallback) | None — `sendTelegramMessage` kept for cleaner notification at line 835, `sendSMS` already imported |
| `app/api/logistics/dispatch/route.ts` | 1 (dispatch warnings when no jobs assigned) | Removed `sendTelegramMessage` import, added `sendSMS` from `@/lib/openphone` |
| `app/api/logistics/optimize-day/route.ts` | 1 (optimization warnings) | Removed `sendTelegramMessage` import, added `sendSMS` from `@/lib/openphone` |
| `lib/dispatch.ts` | 1 (`sendOwnerDispatchSummary` function) | None — both `sendTelegramMessage` (used for team-lead routes) and `sendSMS` already imported |
| `lib/rain-day.ts` | 1 (rain day auto-reschedule alert) | Removed `sendTelegramMessage` from import, kept `notifyScheduleChange` for cleaner notifications. `sendSMS` already imported |
| `lib/winbros-alerts.ts` | 1 (`notifyOwner` function) | None — uses dynamic imports. Removed Telegram dynamic import entirely |

---

## Notification Details

### 1. Payment Failed (`stripe/route.ts`)
- **Trigger:** `payment_intent.payment_failed` Stripe webhook
- **Message:** `PAYMENT FAILED` + customer, amount, type, reason, job ID, retry count

### 2. New Booking — Card on File (`stripe/route.ts`)
- **Trigger:** `checkout.session.completed` Stripe webhook (WinBros route-optimization flow)
- **Message:** `NEW BOOKING - CARD ON FILE` + customer, service, date, address, price, assignment status

### 3. Failed Booking — Lead Fallback (`stripe/route.ts`)
- **Trigger:** Card saved but job creation failed (job_id starts with `lead-`)
- **Message:** `NEW BOOKING - CARD ON FILE` + customer, warning, lead ID

### 4. Dispatch Warnings (`logistics/dispatch/route.ts`)
- **Trigger:** `POST /api/logistics/dispatch` when no jobs can be assigned
- **Message:** `LOGISTICS DISPATCH - {date}` + warning list

### 5. Optimization Warnings (`logistics/optimize-day/route.ts`)
- **Trigger:** `POST /api/logistics/optimize-day` when warnings exist
- **Message:** `ROUTE OPTIMIZATION - {date}` + stats, warnings, unassigned count

### 6. Dispatch Summary (`lib/dispatch.ts`)
- **Trigger:** After successful route dispatch
- **Message:** `LOGISTICS DISPATCH - {date}` + jobs dispatched, teams, warnings, unassigned jobs, errors

### 7. Rain Day Auto-Reschedule (`lib/rain-day.ts`)
- **Trigger:** Rain detected for a scheduled date
- **Message:** `RAIN DAY AUTO-RESCHEDULE` + weather info, jobs affected/rescheduled/failed, notifications sent

### 8. WinBros Alerts (`lib/winbros-alerts.ts`)
- **Trigger:** High-value jobs, underfilled days, stacked reschedules, etc.
- **Message:** `[WinBros Alert]` + alert message
- **Note:** Previously had dual Telegram + SMS. Simplified to SMS-only. Uses env vars (`OWNER_PHONE_WINBROS` or `OWNER_PHONE`) instead of tenant object.

---

## Formatting Conversion

| HTML (Telegram) | Plain Text (SMS) |
|-----------------|------------------|
| `<b>Payment Failed</b>` | `PAYMENT FAILED` |
| `<b>New Booking — Card on File</b>` | `NEW BOOKING - CARD ON FILE` |
| `<b>Logistics Dispatch — {date}</b>` | `LOGISTICS DISPATCH - {date}` |
| `<b>Route Optimization — {date}</b>` | `ROUTE OPTIMIZATION - {date}` |
| `<b>Rain Day Auto-Reschedule</b>` | `RAIN DAY AUTO-RESCHEDULE` |
| `<b>Warnings:</b>` | `WARNINGS:` |
| `<b>Errors:</b>` | `ERRORS:` |
| `⚠️` emoji | `WARNING:` |
| `—` (em dash) | `-` (regular dash) |
| `escapeHtml()` wrapping | Removed (not needed for plain text) |

---

## Verification

### Prerequisites
- Set `owner_phone` in Supabase `tenants` table to your phone number (E.164 format, e.g. `+15551234567`)
- Set `OWNER_PHONE_WINBROS` or `OWNER_PHONE` env var to same number (for winbros-alerts)
- Build passes: `npx next build` — all routes compile, no import or type errors

### Testing Plan

| # | Notification | How to Trigger | Status |
|---|-------------|----------------|--------|
| 1 | Payment Failed | Use Stripe test card `4000000000000002` (always declines) or `4000000000009995` (insufficient funds) to create a payment — webhook fires `payment_intent.payment_failed` | Testable |
| 2 | New Booking - Card on File | Complete checkout flow with Stripe test card `4242424242424242` — webhook fires `checkout.session.completed` | Testable |
| 3 | Failed Booking - Lead Fallback | Checkout where `job_id` starts with `lead-` but job creation fails (e.g. missing required fields) | Testable (hard to trigger naturally) |
| 4 | Dispatch Warnings | `POST /api/logistics/dispatch` with a date that has jobs but no active teams — produces warnings with 0 jobs dispatched | Testable |
| 5 | Optimization Warnings | `POST /api/logistics/optimize-day` with a date that has more jobs than teams can handle — produces warnings | Testable |
| 6 | Dispatch Summary | `POST /api/logistics/dispatch` with a date that has jobs AND active teams — fires after successful dispatch | Testable |
| 7 | Rain Day Auto-Reschedule | `POST /api/logistics/rain-day` for a date with scheduled jobs | **BLOCKED** — Weather API deferred (no `OPENWEATHER_API_KEY` configured). Rain-day auto-rescheduling is silently disabled. All call paths fail gracefully. To unblock: add `OPENWEATHER_API_KEY` env var. See Master plan 2-19-2026, line 104. |
| 8 | WinBros Alerts | Create a high-value job ($1,000+), make an underfilled day, or trigger stacked reschedules — or call `GET /api/cron/unified-daily` with cron auth | Testable |

### Recommended Test Order
1. **#4 or #5** (logistics) — easiest, single API call
2. **#1** (payment failed) — straightforward with Stripe test cards
3. **#2** (new booking) — test checkout flow
4. **#6** (dispatch summary) — needs real jobs + teams
5. **#8** (alerts) — via cron or manual trigger
6. **#3** (lead fallback) — hard to trigger, test last or skip
7. **#7** (rain day) — **blocked until weather API key is added**

### Test Results

| # | Notification | Result | Date |
|---|-------------|--------|------|
| 1 | Payment Failed | | |
| 2 | New Booking - Card on File | | |
| 3 | Failed Booking - Lead Fallback | | |
| 4 | Dispatch Warnings | | |
| 5 | Optimization Warnings | | |
| 6 | Dispatch Summary | | |
| 7 | Rain Day Auto-Reschedule | BLOCKED (no weather API key) | |
| 8 | WinBros Alerts | | |

---

## Notes

- Cleaner Telegram notifications are **unchanged** — only owner-directed messages were converted
- The `sendTelegramMessage` import was preserved in files that still use it for cleaner/team-lead messages (`stripe/route.ts`, `lib/dispatch.ts`)
- The `escapeHtml()` helper in `lib/dispatch.ts` was removed from the owner SMS function but kept in the file (still used by `sendRouteToTeamLead`)
