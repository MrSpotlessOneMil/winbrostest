# Texas Nova Cleaning — Live-State Audit + Remediation

**Discovery date:** 2026-04-20
**Tenant slug:** `texas-nova`
**Tenant ID:** `617d0f83-dede-46b3-b1fb-298b59517046`
**Tenant created:** 2026-04-14 (~6 days live at audit; Dominic remembered ~3 weeks)
**Owner phone:** +1 (713) 594-4493 (Patrick)
**SDR persona:** Mary
**Timezone:** America/Chicago ✓
**Service area:** Houston, Baytown, Pasadena, Pearland, Sugar Land, Katy, Humble, Spring, Cypress, The Woodlands, **Dallas, Fort Worth, Austin, San Antonio**
**Currency:** USD ✓
**Active:** true ✓

Texas Nova was onboarded as an Osiris HC tenant — NOT a new setup. This doc
audits what's actually live vs what's missing, and documents the remediation.
The big finding: `pricing_tiers` never seeded. Everything else checked out.

---

## Audit results (live DB state, 2026-04-20)

| Check | Status | Detail |
|---|---|---|
| tenants row | ✓ | `617d0f83-dede-46b3-b1fb-298b59517046` |
| timezone | ✓ | `America/Chicago` |
| openphone_api_key | ✓ | set (non-null) |
| openphone_phone_id | ✓ | `PN2DMeoAmc` |
| workflow_config.sms_auto_response_enabled | ✓ | true |
| workflow_config.monthly_followup_enabled | ✓ | true |
| workflow_config.use_vapi_inbound | ✓ | true |
| workflow_config.use_ghl | ✓ | false (and `ghl_bridge_enabled` now explicitly gated in code — see T2 fix) |
| workflow_config.use_retargeting | ✓ | true |
| **pricing_tiers** | **✗ EMPTY (0 rows)** | Onboarding step silently skipped. Quote engine falls back to `formulaPrice()` in `quote-pricing.ts:259` — root cause of Linda's $562 inflated quote. |
| pricing_addons | ✓ | 32 rows seeded (custom — different from the 7-row default. Patrick gave his rate card at onboarding.) |
| leads table | ✓ live | 4,039 rows |
| customers table | ✓ live | 4,039 rows |
| jobs table | ⚠ low conversion | 4 rows (0.1% of leads — partly explained by cold outreach without cadence, T5; pricing issue T7; stall T4 — all fixed in this branch) |
| Linda Kingcade | ✓ in DB | Lead 5102, source=`meta` (came via Meta Lead Ad "Video 1 \| Quick Form \| Dallas", NOT the Osiris website form). |

## Pricing_addons already seeded (no changes needed)

32 flat-price addons across Texas Nova; notable ones:

| Key | Label | Flat $ |
|-----|-------|--------|
| interior_windows | Interior Windows (Flat Rate) | 60 |
| baseboards | Baseboards | 45 (but ignored in deep tier per TIER_UPGRADES) |
| ceiling_fans | Ceiling Fans | 30 (same) |
| heavy_duty | Heavy Duty | 135 |
| same_day_rush | Same-Day / Rush Cleaning | 75 |
| inside_cabinets | Inside Cabinets | 65 |
| grout_cleaning | Grout Cleaning | 75 |
| interior_walls | Interior Walls | 95 |
| pet_hair_deep_removal | Pet Hair Deep Removal | 65 |

There is no `behind_appliances` addon. When Linda's form quote referenced
"behind appliances", either (a) the form used a different addon key (e.g.,
`heavy_duty` at $135) and math matches $362 (standard 3/2 base) + $60 windows + $135 heavy = $557 (~$562), or (b) the selection was handled via message-text LLM estimation. Either way, seeding `pricing_tiers` makes the deep-tier match Patrick's intended bands.

## Remediation (applied on branch fix/11-bug-complete-2026-04-20)

1. **Seed missing pricing_tiers** — migration `scripts/40-seed-texas-nova-pricing-tiers.sql` inserts 14 default rows (7 standard + 7 deep). Idempotent (skips if any row already exists). Apply via Supabase SQL editor or CLI. Mirrors the values `getDefaultPricingTiers()` would have produced during onboarding.
2. **GHL bridge** already decommissioned in code (T2 fix + runbook `docs/ghl-decom-texas-nova.md`). Config already has `use_ghl: false` and the webhook returns 410 for this slug.
3. **Health check auto-detect** — `system-health` cron now reports pricing_tiers count per tenant. An empty result for any active HC tenant shows up in the dashboard + `system_health` table. Prevents the next tenant silently landing in the same state.

## Post-remediation verification

After running migration 40 against Supabase:

```bash
# 1. Row count
curl -sH "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  "https://kcmbwstjmdrjkhxhkkjt.supabase.co/rest/v1/pricing_tiers?tenant_id=eq.617d0f83-dede-46b3-b1fb-298b59517046&select=*" -I \
  | grep -i content-range
# Expect: Content-Range: 0-13/14

# 2. Run the health probe from T1
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://cleanmachine.live/api/health/form-submit?tenant=texas-nova"
# Expect: ok=true on every check

# 3. Compute the Linda quote
# 3 bed / 2 bath deep = $425 base (from new tier)
# + interior_windows = $60
# + baseboards = $0 (deep includes)
# Expected: ~$485, down from $562
```

## Still todo (Dominic / Patrick)

- **Rate card reconciliation with Patrick** — the seed values are the
  HC-platform defaults, NOT Patrick's actual rate card. Most Houston-area
  cleaners run slightly below LA rates — Patrick should compare the 14 rows
  to his Dallas/Houston prices and adjust in the dashboard or via a one-off
  SQL update. Cleanmachine.live dashboard has a tenant settings page that
  edits these rows directly.
- **Texas Nova website form** — Linda came in via Meta Lead Ad, not the
  Osiris web form. If Patrick has a separate Texas Nova website that's
  meant to POST to Osiris, point it at
  `https://cleanmachine.live/api/webhooks/website/texas-nova`. The
  structured errors from T1 will surface any remaining issue.
- **Decommission GHL** — Patrick runs through `docs/ghl-decom-texas-nova.md`
  (takes about 30 minutes on the GHL side).

## Reference

- Onboarding code that should have seeded this: `apps/house-cleaning/app/api/admin/onboard/route.ts:239-265`
- Default tiers source: `apps/house-cleaning/lib/admin-onboard.ts:469-486`
- Pricing engine: `packages/core/src/quote-pricing.ts`
- Formula fallback (currently active for Texas Nova): `quote-pricing.ts:259-265`
- Health probe: `apps/house-cleaning/app/api/health/form-submit/route.ts`
- GHL decom: `docs/ghl-decom-texas-nova.md`
