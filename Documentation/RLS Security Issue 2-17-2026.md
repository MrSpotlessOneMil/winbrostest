# ⚠️ Important: Supabase Client & RLS Considerations

The code has a subtle but critical issue regarding **Row-Level Security (RLS)**.

---

## 📌 Issue Overview

`getSupabaseClient()` currently **resolves to the service role key** in practice.

Check `lib/supabase.ts` (lines 157–161):

```ts
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||  // ← picked first
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_ANON_KEY ||           // ← only if service key missing
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Because `SUPABASE_SERVICE_ROLE_KEY` is set:

- Both `getSupabaseClient()` and `getSupabaseServiceClient()` **resolve to the service role key**.
- **Every database operation** — customers, jobs, leads, cleaners, calls, messages — is performed using a **key that bypasses RLS entirely**.

---

## 🔍 Implications for RLS

| Scenario | Impact |
|----------|--------|
| **Enable RLS + create policies now** | Nothing breaks, but **policies are ignored**. Service role bypasses RLS. |
| **Want RLS to actually protect data** | Must refactor `getSupabaseClient()` to use **anon key + user JWT context**. Significant architecture change required. |
| **Supabase Realtime subscriptions (if used)** | These are usually using the anon key separately, so may behave differently. |

---

## ⚠️ Key Takeaways

1. **Enabling RLS today is safe** — it will not break functionality.  
2. **It does NOT enforce row-level security** until `getSupabaseClient()` is refactored.  
3. **Recommended approach**:
   - Separate **server-side admin operations** → use service role key (`getSupabaseServiceClient()`)  
   - Separate **tenant-scoped operations** → use anon key + JWT, enforce RLS policies  
4. **Refactor is non-trivial** — requires updating all client calls and ensuring proper JWT context for user-level data.

---

> ⚡ Short summary: RLS enforcement requires a **codebase refactor**. Until then, all operations effectively run as admin, bypassing policies.
