# Cleaner Portal + SMS Migration (March 2026)

## What happened

We ripped out ALL Telegram integration from Osiris and replaced it with two things:

1. **Cleaner Portal** — a mobile-friendly web page at `/crew/[token]` where cleaners manage their jobs
2. **SMS via OpenPhone** — notifications, reminders, and command parsing (OMW, YES/NO, etc.)

This is a full replacement. Telegram is dead. No bot, no chat IDs, no webhook. Everything goes through SMS and the portal now.

---

## How the Cleaner Portal works

Every cleaner gets a unique UUID token (stored in `cleaners.portal_token`). Their portal URL is:

```
https://spotless-scrubbers-api.vercel.app/crew/{token}
```

No login. The token IS the auth (same pattern as the customer quote page). The portal has:

- **Home page** (`/crew/[token]`) — Today's jobs, upcoming (7 days), past (30 days), pending assignments to accept/decline
- **Job detail page** (`/crew/[token]/job/[jobId]`) — Address (with Google Maps link), status buttons (OMW → HERE → DONE), cleaning checklist, payment method selector, and a chat UI to message the customer

### Cleaner-to-customer messaging

Cleaners can message customers from the job detail page. Messages go through the business OpenPhone number — the customer never sees the cleaner's personal number (exception: WinBros shows customer phone per their `use_hcp_mirror` flag). Customer replies show up in the portal chat. Rate limited to 10 messages per job per day.

---

## How SMS commands work

Cleaners can also do everything via text instead of the portal. The OpenPhone webhook now parses inbound cleaner messages:

| Text | Action |
|------|--------|
| `omw`, `on my way`, `heading over` | Sets job status to OMW, notifies customer |
| `here`, `arrived`, `i'm here` | Sets job status to HERE, notifies customer |
| `done`, `finished`, `all done` | Sets job status to DONE, notifies customer, triggers post-job flow |
| `yes`, `accept`, `ok` | Accepts pending job assignment |
| `no`, `decline`, `can't` | Declines assignment, cascades to next cleaner |

Anything else from a cleaner gets forwarded to the business owner.

---

## Database changes

Migration: `scripts/13-cleaner-portal.sql` (already applied as `cleaner_portal_v2`)

- `cleaners.portal_token` — UUID token for portal access (backfilled on all 24 existing cleaners)
- `jobs.cleaner_omw_at`, `jobs.cleaner_arrived_at` — OMW/HERE timestamps
- `jobs.payment_method` — Card/Cash/Check/Venmo
- `cleaning_checklists` table — Per-tenant, per-service-category checklist templates (35 items seeded)
- `job_checklist_items` table — Per-job completion tracking
- `pending_sms_assignments` table — Tracks active YES/NO offers for SMS reply handling

---

## Files created

| File | What it does |
|------|-------------|
| `lib/cleaner-sms.ts` | All cleaner notifications via SMS. Drop-in replacement for `lib/telegram.ts` |
| `app/crew/[token]/page.tsx` | Portal home page (React, mobile-first) |
| `app/crew/[token]/job/[jobId]/page.tsx` | Job detail page (checklist, status, chat, payment) |
| `app/api/crew/[token]/route.ts` | Portal API — GET profile/jobs, PATCH availability |
| `app/api/crew/[token]/job/[jobId]/route.ts` | Job API — GET details, PATCH status/checklist/payment, POST accept/decline |
| `app/api/crew/[token]/job/[jobId]/messages/route.ts` | Messaging API — GET thread, POST send message to customer |
| `scripts/13-cleaner-portal.sql` | Database migration |

## Files deleted

| File | Why |
|------|-----|
| `lib/telegram.ts` (1232 lines) | Dead code — nothing imports it anymore |
| `app/api/teams/send-telegram/route.ts` | Dead route |

## Files modified (22 files)

Every file that imported `lib/telegram` was updated to use `lib/cleaner-sms` or `lib/openphone` directly. Guards changed from `cleaner.telegram_id` to `cleaner.phone`. Full list:

**Libraries:** `cleaner-assignment.ts`, `dispatch.ts`, `rain-day.ts`, `supabase.ts`, `route-optimizer.ts`, `openphone.ts`

**Crons:** `send-reminders/route.ts`, `check-timeouts/route.ts`, `crew-briefing/route.ts`

**Webhooks:** `openphone/route.ts` (major — added cleaner SMS routing), `stripe/route.ts`, `housecall-pro/route.ts`

**Actions:** `assign-cleaner/route.ts`, `complete-job/route.ts`

**Other API:** `assistant/chat/route.ts`, `automation/send-reminder/route.ts`, `rain-day/route.ts`, `jobs/route.ts`

**Dashboard:** `admin/page.tsx` (removed Telegram fields, setup checklist, connection testing), `admin/cleaners-manager.tsx` (portal links instead of Telegram IDs), `teams/page.tsx`, `teams/manage/page.tsx` (SMS-based instead of Telegram chat)

**Telegram webhook stubs:** `telegram/route.ts` and `telegram/[slug]/route.ts` kept as stubs returning `{ deprecated: true }` so external services don't get 404s.

---

## SMS throttle change

`sendSMS()` in `lib/openphone.ts` now accepts an optional `{ skipThrottle: true }` parameter. All cleaner-directed messages skip the 20/day throttle since operational SMS volume (assignments, reminders, confirmations) can exceed that for busy cleaners. Customer-directed messages still throttled normally.

---

## What's NOT done yet (Phase 2)

- Pay tracking dashboard (earnings, tips, bonuses)
- Reviews showcase
- Gamification (leaderboard, streaks, badges)
- Customer notes per home
- Before/after photos
- Route map with Google Maps
- Cleaner referral program

---

## How to verify it works

1. Get a cleaner's portal token: `SELECT name, portal_token FROM cleaners WHERE phone IS NOT NULL LIMIT 1`
2. Open `/crew/{token}` — should see their jobs
3. Click a job — should see checklist, status buttons, messaging
4. Try OMW → HERE → DONE flow
5. Send a message from the portal — customer should get SMS from business number
6. Text "YES" or "OMW" from a cleaner's phone to the business number — should route correctly
