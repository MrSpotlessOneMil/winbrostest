# 🚀 OSIRIS x WinBros  
## Phase 1 – Requirements Gap Analysis & Action Plan

**Agreement Signed:** 1/20/2026  
**Target Completion:** ~2/10/2026  
**Live Trial:** 2 weeks post-build  
**Current Completion:** ~70%

---

# ✅ WHAT'S DONE (~70%)

## Lead & Intake System
- Lead intake from all sources (Meta/GHL, Phone/VAPI, SMS/OpenPhone, HCP webhooks)
- AI call answering + transcript parsing
- Unified lead pipeline with source attribution
- Multi-stage follow-up automation (5 stages)

## Scheduling & Operations
- Calendar-based job scheduling (drag-drop)
- Rain-day rescheduling workflow
- Stripe payment links + post-completion payment trigger
- Telegram cleaner notifications + onboarding
- Multi-tenant architecture

## Performance & Tracking
- Leaderboard
- Earnings tracking
- Tips tracking
- Upsell tracking

## Admin & Infrastructure
- Admin panel with per-tenant controls + credentials
- System event logging / audit trail

---

# ❌ WHAT'S NOT DONE (~30%)

---

# 🔴 CRITICAL

## RLS Security Bypass

**Problem:**  
`SUPABASE_SERVICE_ROLE_KEY` is used everywhere, bypassing Row-Level Security.

**Impact:**  
- Enabling RLS does nothing.
- All operations run as admin.

**Required Fix:**  
Refactor to separate:
- Service role → server/admin operations
- Anon key + JWT → tenant-scoped operations

**Effort:** Medium–High

---

# 📋 MISSING CONTRACT FEATURES

## Internal Operations

- Daily crew-lead briefings (weather + schedule + upsell notes)
- Review-only follow-up logic (skip payment, only request review)
- Underfilled day alerts
- Stacked reschedule alerts
- High-value job alerts ($1,000+)
- Seasonal reminders
- Service frequency nudges
- Equal tip distribution logic
- Google review $10 attribution verification
- Dedicated job/payment exception handling UI

---

# 🟡 RELIABILITY GAPS

- Weather API returns fake data (needs real API key)
- Payment retry + card update flow needs verification
- Cron race conditions (no distributed locking)
- Debug logging still in production code

---

# 📑 REQUIREMENT MAPPING (DETAILED)

---

## 1. Lead Intake & Call Handling

| Requirement | Status | Notes |
|-------------|--------|-------|
| AI call answering | ✅ Done | VAPI integration |
| Call logging | ✅ Done | calls table + Claude parsing |
| Escalation to humans | ✅ Done | Telegram alerts |
| Meta leads | ✅ Done | GHL webhook |
| Google LSA | ⚠ Partial | Via HCP only |
| Website forms | ✅ Done | GHL + HCP |
| Phone/SMS | ✅ Done | OpenPhone + VAPI |
| Unified pipeline | ✅ Done | Source attribution present |
| One-time alerts | ✅ Done | Scheduled tasks |

---

## 2. Booking Control

| Requirement | Status |
|-------------|--------|
| Client-defined rules | ✅ Done |
| Manual override | ✅ Done |
| Pricing approval | ✅ Done |

---

## 3. Scheduling Safeguards

| Requirement | Status |
|-------------|--------|
| Automated rescheduling | ✅ Done |
| Manual override | ✅ Done |

---

## 4. Payments

| Requirement | Status |
|-------------|--------|
| Job state tracking | ✅ Done |
| Stripe payment trigger | ✅ Done |
| Payment retries | ⚠ Partial |
| Card update flow | ⚠ Partial |

---

## 5. Lifecycle Messaging

| Requirement | Status |
|-------------|--------|
| Missed call follow-up | ✅ Done |
| Non-booked follow-ups | ✅ Done |
| Seasonal reminders | ⚠ Partial |
| Service frequency nudges | ⚠ Partial |
| Review follow-ups | ⚠ Partial |
| Review-only logic | ❌ Not Done |

---

## 6. Internal Alerts

| Requirement | Status |
|-------------|--------|
| High-value alerts | ⚠ Partial |
| Underfilled day alerts | ❌ Not Done |
| Stacked reschedules | ❌ Not Done |
| Daily crew weather briefings | ⚠ Partial (fake weather data) |
| Daily schedule briefing | ❌ Not Done |
| Upsell briefing inclusion | ❌ Not Done |

---

## 7. Incentive Tracking

| Requirement | Status |
|-------------|--------|
| Upsells per job/crew | ✅ Done |
| Equal tip distribution | ⚠ Partial |
| Google review $10 incentive | ⚠ Partial |
| Centralized dashboard | ✅ Done |

---

## 8. Admin Control Panel

| Requirement | Status |
|-------------|--------|
| Rain-day controls | ✅ Done |
| Job/payment exceptions | ⚠ Partial |
| Manual retry tools | ⚠ Partial |

---

## 9. Access & Security

| Requirement | Status |
|-------------|--------|
| Minimum necessary permissions | ❌ CRITICAL GAP |
| No password storage | ✅ Done |
| Full audit trail | ✅ Done |
| Access revocation automation | ⚠ Partial |

---

# 🔥 PRIORITIZED ACTION ITEMS

---

## 🥇 Priority 1 — Security (Must Fix Before Trial)

1. **RLS Enforcement Refactor**  
   Separate service role from tenant-scoped operations.  
   Effort: Medium–High

---

## 🥈 Priority 2 — Core Missing Features

2. Daily Crew Briefings  
3. Review-Only Follow-Up Logic  
4. Underfilled Day + Stacked Reschedule Alerts  
5. High-Value Job Alerts  
6. Seasonal Reminders  
7. Service Frequency Nudges  
8. Equal Tip Distribution Logic  
9. Google Review $10 Attribution  

---

## 🥉 Priority 3 — Reliability & Polish

10. Real Weather API  
11. Verify Stripe Retry/Card Update  
12. Dedicated Exception Panel  
13. Strip Debug Logging  
14. Normalize `form_data` Type  

---

## 🏗 Priority 4 — Operational Hardening

15. Fix Cron Race Conditions (`SELECT FOR UPDATE SKIP LOCKED`)  
16. Replace 3-Second Polling with Realtime Subscriptions  

---

# 🧪 VERIFICATION PLAN

After completion:

### Lead Flow
- Send test leads from all sources
- Confirm correct source attribution

### Follow-Ups
- Verify 5-stage cascade triggers properly

### Booking
- Create HCP job → verify calendar + Telegram notify

### Payment
- Complete job → verify Stripe link → verify webhook updates

### Review-Only
- Complete job w/o invoice → confirm only review sent

### Rain Day
- Trigger reschedule → verify movement + notifications

### Alerts
- Create $1,000 job → verify Telegram alert
- Create underfilled day → verify alert triggers

### Leaderboard
- Verify tips, upsells, review incentives

### Admin
- Retry payment manually
- Mark job complete
- Toggle rain-day controls

### Security
- Confirm tenant isolation
- Verify RLS enforcement after refactor

---

# 📌 Summary

**Current State:** ~70% complete  
**Biggest Risk:** RLS security bypass  
**Before Trial:** Must fix RLS + core missing contract features  
**After Completion:** System ready for controlled 2-week live trial

---

