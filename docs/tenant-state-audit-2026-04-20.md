# Tenant State Audit — 2026-04-20

Live audit of every tenant in `kcmbwstjmdrjkhxhkkjt.supabase.co` against the
new `feedback_verify_onboarding_data` rule and the broader fix package on
branch `fix/11-bug-complete-2026-04-20`.

## All tenants (live DB)

| Active | Slug | Created | Type | OpenPhone | pricing_tiers | pricing_addons | Leads | Customers | Jobs |
|---|---|---|---|---|---|---|---|---|---|
| ✗ | `winbros` | 2026-02-01 | Window (HCP mirror) | n/a | 0 (uses workflow_config.window_tiers) | n/a | n/a | n/a | n/a |
| ✓ | `spotless-scrubbers` | 2026-02-25 | House | ✓ `PNvRA7PaW4` | **306** ✓ | 23 | 146 | 2,590 | 75 |
| ✗ | `cedar-rapids` | 2026-02-26 | House | (was set) | n/a (deactivated) | n/a | n/a | n/a | n/a |
| ✓ | `west-niagara` | 2026-04-01 | House | ✓ `PNqgmlFDa0` | **21** (7 std + 7 deep + 7 move) ✓ | 20 | 195 | 194 | 23 |
| ✓ | `crystal-clear` | 2026-04-13 | **WINDOW** (Springfield IL) | ✗ NULL | 0 (correct — uses JSONB pricebook) | 0 | 0 | 12 | 16 |
| ✓ | `sparkle-home` | 2026-04-13 | House (Austin TX) | ✗ NULL | **0** ⚠ | **0** ⚠ | 10 | 12 | 18 |
| ✓ | `texas-nova` | 2026-04-14 | House (Houston/Dallas/FW/Austin/SA) | ✓ `PN2DMeoAmc` | **0** ✗ | 32 | **4,039** | **4,039** | 4 |

## Findings & recommendations

### 1. Texas Nova — REAL biz, missing pricing_tiers (critical)

Already addressed earlier this session: migration `scripts/40-seed-texas-nova-pricing-tiers.sql` (now 21 tier rows: 7 standard + 7 deep + 7 move-out — they DO offer move-in/out per their active jobs). Apply when ready.

### 2. Sparkle Home — looks like a demo, decide and act

Indicators of a demo tenant:
- `openphone_phone_id` is NULL → cannot send/receive SMS
- `owner_phone` = `+15125550001` (555-prefix is reserved test range)
- Lead names: Olivia, Marcus, Sophie, Nathan, Rachel — pattern matches the seed-demo-data script
- All 18 jobs have `status='pending'` from creation date 2026-04-13 — none progressed

**Two options:**

**A. If demo:** Mark inactive so it stops appearing in active-tenant queries.
```sql
UPDATE tenants SET active = false WHERE slug = 'sparkle-home';
```

**B. If you plan to activate as a real prospect/sales demo:** Seed pricing.
```sql
-- Would mirror migration 40 but with tenant_id swapped to sparkle-home.
-- Skipping unless you confirm — don't want to seed a tenant we're about to delete.
```

### 3. Crystal Clear — window tenant, false-positive on tier check

Crystal Clear Windows (Springfield IL) is a **window-cleaning** business. Window pricing lives in `tenants.workflow_config.window_tiers` JSONB (see `packages/core/src/pricebook-db.ts`), not `pricing_tiers`. So 0 rows in `pricing_tiers` is correct — the system-health detector was over-broad.

**Fixed in this session:** updated `apps/house-cleaning/app/api/cron/system-health/route.ts checkOsirisPricing()` to discriminate window tenants by:
1. `workflow_config.use_hcp_mirror === true` (WinBros pattern)
2. `workflow_config.use_team_routing === true` (window-ops pattern)
3. Name or service_description contains "window"

Crystal Clear matches discriminator 2 + 3 → excluded from the alert.

Same demo signals as Sparkle Home (NULL openphone_phone_id, +12175550001 test phone, no leads, all jobs pending from creation day). Likely also a demo. Suggest:
```sql
UPDATE tenants SET active = false WHERE slug = 'crystal-clear';
```
Unless these are an upcoming client — in which case seed `workflow_config.window_tiers` JSONB and provision an OpenPhone number.

### 4. Both demo tenants are calling cron paths today

Because they are `active=true`, every cron that loops `getAllActiveTenants()` includes them. Most crons skip safely (no openphone, no real customers), but it does waste cycles and inflates `system_events` noise. Deactivating cleans this up.

### 5. The system-health cron was orphaned (dead-code path)

Found earlier: the route only existed at root `app/` (which `winbrostest/CLAUDE.md` flags as dead code). Now copied to `apps/house-cleaning/app/api/cron/system-health/route.ts` so the registered Vercel cron actually executes. Once deployed, this exact class of "tenant onboarded with empty pricing_tiers" bug auto-surfaces in `system_health` table within 6 hours.

### 6. WinBros and Cedar Rapids are inactive (confirmed)

Per `active=false` flag. WinBros uses HCP mirror, Cedar is decommissioned (matches the Cedar Rapids OpenPhone-out-of-credits memory). No action needed.

## Migrations to apply (order)

```bash
# Already authored on branch, additive + idempotent
psql "$DATABASE_URL" -f scripts/37-conversation-lifecycle-columns.sql
psql "$DATABASE_URL" -f scripts/38-sms-outreach-queue.sql
psql "$DATABASE_URL" -f scripts/39-conversation-state.sql
psql "$DATABASE_URL" -f scripts/40-seed-texas-nova-pricing-tiers.sql

# Optional — if you confirm both are demos:
psql "$DATABASE_URL" -c "UPDATE tenants SET active = false WHERE slug IN ('crystal-clear','sparkle-home');"
```

## Verification after migration 40

```bash
# Texas Nova should now have 21 tier rows (7 std + 7 deep + 7 move)
curl -sH "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "https://kcmbwstjmdrjkhxhkkjt.supabase.co/rest/v1/pricing_tiers?tenant_id=eq.617d0f83-dede-46b3-b1fb-298b59517046&select=service_type" -I \
  | grep -i content-range
# Expect: Content-Range: 0-20/21

# After branch merges, the system-health cron will alert on any future
# onboarded HC tenant with empty pricing_tiers within 6 hours.
```

## 7. Additional silent-gap findings (keep-pushing audit)

### 7a. Cross-tenant brand-leak fallback in `sendSMS` (FIXED)

`packages/core/src/openphone.ts` (and the HC lib shadow) used
`tenant.openphone_phone_id || process.env.OPENPHONE_PHONE_ID` as the outbound
phone ID. If a tenant was missing `openphone_phone_id` (current case:
sparkle-home, crystal-clear), `sendSMS` would quietly send **from whichever
tenant's phone ID is in the shared env** — a multi-tenant brand-leak bug.
Combined with sparkle-home having `sms_auto_response_enabled=true`, any
inbound conversation would generate responses from the wrong phone.

**Fixed in this session:** removed the env fallback in both core and HC lib.
Missing `tenant.openphone_phone_id` now fails closed with
`"OpenPhone phone number ID not configured for tenant — refusing to send"`.
The cleaner-specific path still falls through to the tenant's main number
when `openphone_cleaner_phone_id` is absent (intended).

### 7b. West Niagara timezone drift

`tenants.timezone` for `west-niagara` is `America/New_York`. The tenant serves
the Niagara region of Ontario, Canada — correct IANA zone is
`America/Toronto`. Both have the same UTC-5/-4 offset and DST rules, so
downstream behavior (9-21 quiet hours, cron gating) is numerically identical
today, but the drift is a data-hygiene issue that will bite the moment we
rely on timezone for location-aware features (e.g. currency defaults, CA vs
US compliance flags, statutory holidays).

**Recommendation (one-line SQL — run when convenient):**
```sql
UPDATE tenants SET timezone='America/Toronto' WHERE slug='west-niagara';
```

### 7c. Spotless pricing_tiers structure (HEALTHY — no action)

Spotless's 306 rows = 9 beds (1-9) × 17 baths (1.0-9.0 in 0.5 increments) × 2
service types (standard + deep). No exact duplicates. `max_sq_ft` grows
monotonically with bedrooms (e.g. 3/2=1500, 4/3=2500). Prices span $200-$1225
(standard) and $225-$1900 (deep) — matches the $150-$700 typical range for
realistic small units and scales up for 9-bedroom homes. Confirmed
sqft-graduated via the full (bed, bath) grid — the lookup uses
`SELECT ... WHERE bedrooms=X AND bathrooms=Y AND max_sq_ft>=Z ORDER BY max_sq_ft LIMIT 1`.

### 7d. All 30 HC crons have route files (no orphans beyond system-health)

Audited `apps/house-cleaning/vercel.json` — all 30 registered crons
(including the 3 new: `drain-sms-queue`, `cold-followup`,
`release-takeover`) have corresponding route files under
`apps/house-cleaning/app/api/cron/`. No other orphans like system-health was.

## What this changes for future onboardings

The admin onboarding flow at `apps/house-cleaning/app/api/admin/onboard/route.ts:239-265` already attempts to seed pricing during step 3, BUT:
- It only inserts when count==0 (correct)
- It silently records `result.steps.seed_pricing.status='failed'` on error (would be visible in API response, not as a prod alert)
- If `seed_pricing` is passed as `'skip'`, it's skipped without flagging
- No follow-up validation step

The system-health cron (now functional) closes this loop. Recommend keeping the `seed_pricing='skip'` UI option but adding a banner on the tenant detail page showing "WARNING: 0 pricing tiers — quotes will use formula fallback" for any tenant in this state.
