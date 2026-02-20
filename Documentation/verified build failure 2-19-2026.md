# Verified: Vercel Build Failure — Top-Level createClient()

**Fix Date:** 2026-02-19
**Verified:** 2026-02-19
**Severity:** Medium (blocks all Vercel deployments)
**Outcome:** Build passes, all routes compile

---

## Problem

Vercel preview deployments failed with:
```
Error: supabaseUrl is required.
Failed to collect page data for /api/cron/crew-briefing
Failed to collect page data for /api/webhooks/telegram/winbros
```

During `next build`, Vercel evaluates all route modules to collect page data. Two library files created Supabase clients at **module top-level** — before environment variables are available:

```ts
// lib/winbros-alerts.ts (line 12)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,   // undefined at build time
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// lib/crew-performance.ts (line 12)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,   // undefined at build time
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

**Affected routes:**
- `/api/cron/crew-briefing` → imports `winbros-alerts.ts`
- `/api/webhooks/telegram/winbros` → imports `crew-performance.ts`

### Origin

Introduced in commit `5b69a2e` ("Priority 2 contract features: alerts, tips, reviews, crew briefing") merged via PR #5. The bug existed in `Test` and `main` but was not caught because PR #7 was merged without required status checks.

---

## Fix

Replaced top-level `createClient()` with a lazy singleton pattern in both files:

```ts
let _supabase: ReturnType<typeof createClient> | null = null
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _supabase
}
```

All `supabase.from(...)` calls updated to `getSupabase().from(...)`.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/winbros-alerts.ts` | Top-level `const supabase = createClient(...)` → lazy `getSupabase()`, 7 call sites updated |
| `lib/crew-performance.ts` | Top-level `const supabase = createClient(...)` → lazy `getSupabase()`, 13 call sites updated |

---

## Verification

Local `next build` passes after fix — all routes compile including `/api/cron/crew-briefing` and `/api/webhooks/telegram/winbros`.

---

## Note on TypeScript Errors

The IDE shows `Property 'x' does not exist on type 'never'` errors in both files. These are **pre-existing** — caused by `createClient()` being used without Supabase typed database generics. The build config skips type validation (`Skipping validation of types`), so these do not affect the build. They existed before this fix and are unrelated to it.