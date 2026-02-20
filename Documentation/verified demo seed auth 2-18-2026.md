# Verified: Demo Seed Endpoint Authentication

**Fix Date:** 2026-02-17
**Verified:** 2026-02-18
**Severity:** Critical
**Outcome:** Fix confirmed live and working

---

## Problem

The `/exceptions` dashboard page contained a "Demonstration" tab with buttons that inserted fake records (teams, cleaners, jobs, leads, calls, tips, upsells, messages) directly into the live Supabase database. The underlying API endpoint (`/api/demo/seed`) had zero authentication — any HTTP request, even unauthenticated, could trigger data insertion. The sidebar hid the link for non-admins, but any user who knew the URL could access it directly and corrupt production data.

---

## Changes Made

### 1. `lib/auth.ts` — Added shared `requireAdmin` utility

Added a new exported function `requireAdmin(request)`. Centralizes admin check logic (read session cookie → query DB → verify `username === 'admin'`) so all admin routes share one function.

### 2. `app/api/demo/seed/route.ts` — Guarded the POST handler

Added `requireAdmin` check as the first line of the POST handler. Returns HTTP 401 before any data is touched if the caller is not an admin.

### 3. `app/(dashboard)/exceptions/page.tsx` — Gated the Demo tab in the UI

Wrapped the tab trigger and tab content in `{isAdmin && ...}` using the `useAuth()` hook. Non-admin users never see the tab.

### 4. `app/api/admin/tenants/route.ts` — Replaced local `isAdmin` copy

Removed the local `isAdmin()` function, switched to shared `requireAdmin` from `lib/auth`.

### 5. `app/api/admin/users/route.ts` — Replaced local `isAdmin` copy

Same as above — removed local copy, uses shared `requireAdmin`.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/auth.ts` | Added shared `requireAdmin()` utility |
| `app/api/demo/seed/route.ts` | Guarded POST with `requireAdmin()` |
| `app/(dashboard)/exceptions/page.tsx` | Demo tab hidden from non-admin users |
| `app/api/admin/tenants/route.ts` | Replaced local auth copy with `requireAdmin` |
| `app/api/admin/users/route.ts` | Replaced local auth copy with `requireAdmin` |

---

## Verification

### Code Review — All Passed

- **`requireAdmin` — `lib/auth.ts:245–260`**: Reads `winbros_session` cookie, queries `sessions` table joined to `users`, checks expiry, returns `true` only when `username === 'admin'`, returns `false` safely on every failure path (never throws).
- **Seed route — `app/api/demo/seed/route.ts:43–45`**: Guard is the first line of the POST handler — before any database access.
- **Tenants route**: All 4 handlers (GET, POST, PATCH, DELETE) guarded with `requireAdmin`. No local `isAdmin()` copy remains.
- **Users route**: All 4 handlers (GET, POST, PATCH, DELETE) guarded with `requireAdmin`. No local `isAdmin()` copy remains.
- **Exceptions page — `app/(dashboard)/exceptions/page.tsx:75,185,385`**: `isAdmin` sourced from `useAuth()` hook, tab trigger and content both wrapped in `{isAdmin && ...}`.

### Live Attack Simulation

Test method: incognito browser window (no session cookie) → DevTools console → fetch request to production URL.

```js
fetch("/api/demo/seed", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ scenario: "add_lead" })
}).then(r => r.json()).then(console.log)
```

| Deployment | HTTP Status | Response | Verdict |
|------------|-------------|----------|---------|
| **Before fix** | 200 OK | `{ success: true, data: {...} }` | Vulnerable — fake record inserted with zero auth |
| **After fix** | 401 Unauthorized | `{ success: false, error: 'Unauthorized' }` | Blocked — request rejected before touching DB |

---

## Summary

The vulnerability allowed anyone on the internet to insert fake data into the production database by making a single HTTP POST request — no login required. The fix closes this at the API level (server-side), meaning it cannot be bypassed by UI tricks or missing cookies. The before/after attack simulation confirms the fix is active on the live deployment.
