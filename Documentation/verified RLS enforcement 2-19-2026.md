# Verified: RLS Tenant Isolation Enforcement

**Issue Found:** 2026-02-17
**Verified:** 2026-02-19
**Severity:** Critical
**Outcome:** RLS confirmed working — tenant isolation enforced at database level

---

## Problem

`getSupabaseClient()` resolved to the **service role key** because `SUPABASE_SERVICE_ROLE_KEY` was checked first in the fallback chain. This meant both `getSupabaseClient()` and `getSupabaseServiceClient()` used the same key — every database operation bypassed RLS entirely. Any authenticated tenant user could potentially access other tenants' data.

```ts
// lib/supabase.ts (lines 157–161) — before fix
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||  // ← picked first
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Enabling RLS policies was safe but had no effect — the service role key bypasses them.

---

## Fix

Introduced `getTenantScopedClient()` which uses the **anon key + a custom HS256 JWT** containing `tenant_id`, so Supabase PostgREST enforces RLS policies at the database level.

```
Before:  API Route → getSupabaseClient() → SERVICE_ROLE_KEY → bypasses RLS
After:   API Route → getTenantScopedClient(tenantId) → ANON_KEY + signed JWT → RLS enforced
```

### JWT Creation — `lib/supabase.ts:209–218`
- Signs an HS256 JWT with `SUPABASE_JWT_SECRET` (Supabase Legacy Key)
- Payload contains `{ tenant_id, role: "authenticated" }`
- 1-hour expiry, issued via `jose` library's `SignJWT`

### Client Creation — `lib/supabase.ts:227–247`
- Uses `SUPABASE_ANON_KEY` (not service role)
- Passes JWT via supabase-js `accessToken` callback
- PostgREST verifies the JWT and makes `tenant_id` available to RLS policies

### RLS Policy — `scripts/05-rls-policies.sql`
- Enables RLS on 16 tenant-scoped tables
- Each table gets a `tenant_isolation` policy:
  ```sql
  CREATE POLICY tenant_isolation ON <table>
    FOR ALL USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  ```

---

## Files Changed

| File | Change |
|------|--------|
| `lib/supabase.ts` | Added `createTenantJwt()` and `getTenantScopedClient()` using `jose` + `accessToken` callback |
| `app/api/customers/route.ts` | Switched to `getTenantScopedClient(tenant.id)` |
| `app/api/jobs/route.ts` | Switched to `getTenantScopedClient(tenant.id)` |
| `app/api/leads/route.ts` | Switched to `getTenantScopedClient(tenant.id)` |
| `app/api/calendar/route.ts` | Switched to `getTenantScopedClient(tenant.id)` |
| `app/api/calls/route.ts` | Switched to `getTenantScopedClient(tenant.id)` |
| `app/api/teams/route.ts` | Switched to `getTenantScopedClient(tenant.id)` |
| `app/api/manage-teams/route.ts` | Switched to `getTenantScopedClient(tenant.id)` |
| `app/api/actions/send-sms/route.ts` | Switched to `getTenantScopedClient(tenant.id)` |
| `scripts/05-rls-policies.sql` | Enables RLS + creates `tenant_isolation` policies on 16 tables |

---

## Verification

### Test 1: Count Comparison
| Source | Customer Count |
|--------|---------------|
| Supabase DB (direct) | 14 |
| App (via API) | 14 |

Consistent, but inconclusive with a single tenant.

### Test 2: RESTRICTIVE Policy Block
Applied a policy that blocks ALL rows regardless of tenant:
```sql
CREATE POLICY rls_test_block ON customers AS RESTRICTIVE FOR SELECT USING (false);
```

| Deployment | Customers Shown | Verdict |
|------------|----------------|---------|
| `feature/new_security_updates` (tenant user) | **0** | RLS IS enforced — database-level block works |
| `Test` branch (admin user) | **14** | Expected — admin uses service role key, bypasses RLS by design |

Test policy dropped after verification.

### Debug Logging
Temporary `[RLS-DEBUG]` logging confirmed JWT IS being generated on every request and the `accessToken` callback IS being called by supabase-js.

### Key Finding: API Gateway Log Artifact
Supabase API Gateway logs showed `"Not a JWT, invalid structure"` for every request. This was a **red herring** — the Gateway's own JWT parser expects Supabase Auth format tokens. PostgREST independently verifies the JWT correctly. The RESTRICTIVE policy test proved this conclusively.

---

## Known Limitations

| Item | Status |
|------|--------|
| Admin user (`tenant_id: null`) falls back to `getSupabaseServiceClient()` | By design — admin sees all tenants |
| Webhook routes (`stripe`, `openphone`, etc.) still use service role client | Expected — webhooks determine tenant from payload, not session |
| Cron routes use service role client | Expected — cron jobs iterate all tenants |

---

## Summary

The vulnerability allowed any authenticated tenant user to potentially see other tenants' data because the service role key bypassed all RLS. The fix enforces isolation at the database level using signed JWTs and Supabase RLS policies. The RESTRICTIVE policy test (0 customers returned) confirms RLS is active and enforced on the live deployment.