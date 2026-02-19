# Fix: Demo Seed Endpoint Exposed in Production

**Date:** 2026-02-17
**Severity:** Critical
**Status:** Resolved

---

## Problem

The `/exceptions` dashboard page contained a "Demonstration" tab with buttons that inserted fake records (teams, cleaners, jobs, leads, calls, tips, upsells, messages) directly into the live Supabase database. The underlying API endpoint (`/api/demo/seed`) had zero authentication — any HTTP request, even unauthenticated, could trigger data insertion. The sidebar hid the link for non-admins, but any user who knew the URL could access it directly and corrupt production data.

---

## Changes Made

### 1. `lib/auth.ts` — Added shared `requireAdmin` utility

**Change:** Added a new exported function `requireAdmin(request)` at the bottom of the file.

```ts
export async function requireAdmin(request: NextRequest): Promise<boolean>
```

**Why:** The admin check logic (read session cookie → query DB → verify `username === 'admin'`) was previously copy-pasted into each admin route file independently. Centralizing it means if the logic ever changes, it's updated in one place. Any future admin-only route imports this instead of rolling its own.

---

### 2. `app/api/demo/seed/route.ts` — Guarded the POST handler

**Change:** Added `import { requireAdmin } from "@/lib/auth"` and inserted an early return at the top of the `POST` function:

```ts
if (!(await requireAdmin(request))) {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}
```

**Why:** This is the critical layer — the server-side gate. Even if a user bypasses the UI entirely and sends a raw HTTP request (curl, Postman, browser DevTools), the server checks their session against the database and rejects non-admins with `401 Unauthorized` before any data is touched.

---

### 3. `app/(dashboard)/exceptions/page.tsx` — Gated the Demo tab in the UI

**Change:** Added `import { useAuth } from "@/lib/auth-context"` and `const { isAdmin } = useAuth()` inside the component. Wrapped the tab trigger and tab content in `{isAdmin && ...}`:

```tsx
{isAdmin && (
  <TabsTrigger value="demo">Demonstration</TabsTrigger>
)}

{isAdmin && <TabsContent value="demo">
  {/* seed buttons */}
</TabsContent>}
```

**Why:** Defense-in-depth. The API (change 2) is the real security. This layer ensures the UI is clean — non-admin users never see the tab at all, removing the risk of accidental clicks and making the intent clear in the code.

---

### 4. `app/api/admin/tenants/route.ts` — Replaced local `isAdmin` copy

**Change:** Removed the local `isAdmin()` function, removed the `cookies` import, added `import { requireAdmin } from "@/lib/auth"`, replaced all `isAdmin(request)` calls with `requireAdmin(request)`.

**Why:** This file had its own copy of the admin check. Now it uses the shared utility from change 1, eliminating duplication.

---

### 5. `app/api/admin/users/route.ts` — Replaced local `isAdmin` copy

**Change:** Same as change 4 — removed local copy, imported and used `requireAdmin` from `lib/auth`.

**Why:** Same reason — eliminates the duplicate and ensures all admin checks go through one function.

---

## How to Verify

| Scenario | Expected Result |
|---|---|
| Non-admin navigates to `/exceptions` | Only "System Events" and "Exceptions" tabs visible |
| Non-admin POSTs to `/api/demo/seed` | `{ success: false, error: "Unauthorized" }` — HTTP 401 |
| Unauthenticated POST to `/api/demo/seed` | HTTP 401 |
| Admin navigates to `/exceptions` | All 3 tabs visible including Demonstration |
| Admin uses seed buttons | Succeeds as before, no regression |
