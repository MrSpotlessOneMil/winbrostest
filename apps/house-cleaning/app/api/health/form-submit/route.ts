/**
 * Form-Submit Health Probe
 *
 * GET /api/health/form-submit?tenant=<slug>
 *
 * Checks every precondition the website-form webhook needs, WITHOUT creating
 * real data. When a tenant's form returns "Something went wrong" (Linda
 * Kingcade / Texas Nova, 2026-04-20), run this probe to pinpoint the failure
 * without having to comb Vercel logs for a real user submission.
 *
 * Checks:
 *   1. Tenant resolution
 *   2. tenant.openphone_api_key or env fallback configured
 *   3. pricing_tiers has at least one row for this tenant
 *   4. pricing_addons has at least one row for this tenant
 *   5. leads INSERT can actually execute (attempts an insert with a known
 *      probe source_id that we immediately delete — no side effects)
 *   6. customers UPSERT can execute (same pattern)
 *
 * Auth: requires CRON_SECRET bearer (so it's not a public recon endpoint).
 *
 * Output: structured JSON with a check list; any `ok: false` entry pinpoints
 * the failure mode (RLS, missing column, missing env var, etc.).
 */

import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth, unauthorizedResponse } from "@/lib/cron-auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getTenantBySlug } from "@/lib/tenant"

interface CheckResult {
  check: string
  ok: boolean
  detail?: string
  error?: string
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const slug = request.nextUrl.searchParams.get("tenant")
  if (!slug) {
    return NextResponse.json(
      { ok: false, error: "Missing ?tenant=<slug> query param" },
      { status: 400 }
    )
  }

  const checks: CheckResult[] = []
  let allOk = true

  // 1. Tenant resolution
  const tenant = await getTenantBySlug(slug)
  if (!tenant) {
    checks.push({ check: "tenant_resolution", ok: false, error: `Tenant '${slug}' not found` })
    return NextResponse.json({ ok: false, slug, checks }, { status: 200 })
  }
  checks.push({
    check: "tenant_resolution",
    ok: true,
    detail: `id=${tenant.id} name=${tenant.name} tz=${tenant.timezone || 'missing'}`,
  })

  const client = getSupabaseServiceClient()

  // 2. OpenPhone config
  const hasOpenPhone = !!(tenant.openphone_api_key || process.env.OPENPHONE_API_KEY)
  const hasPhoneId = !!(tenant.openphone_phone_id || process.env.OPENPHONE_PHONE_ID)
  const opOk = hasOpenPhone && hasPhoneId
  if (!opOk) allOk = false
  checks.push({
    check: "openphone_config",
    ok: opOk,
    detail: `api_key_source=${tenant.openphone_api_key ? 'tenant' : hasOpenPhone ? 'env' : 'missing'}, phone_id_source=${tenant.openphone_phone_id ? 'tenant' : hasPhoneId ? 'env' : 'missing'}`,
  })

  // 3. pricing_tiers rows
  const { count: pricingTierCount, error: pricingTierErr } = await client
    .from("pricing_tiers")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
  if (pricingTierErr) {
    allOk = false
    checks.push({ check: "pricing_tiers_query", ok: false, error: `${pricingTierErr.code}: ${pricingTierErr.message}` })
  } else {
    const ok = (pricingTierCount || 0) > 0
    if (!ok) allOk = false
    checks.push({
      check: "pricing_tiers_seeded",
      ok,
      detail: `${pricingTierCount || 0} rows`,
      error: ok ? undefined : "No pricing_tiers seeded — pricing falls back to formula (may cause inflated quotes for new tenants)",
    })
  }

  // 4. pricing_addons rows
  const { count: addonCount, error: addonErr } = await client
    .from("pricing_addons")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("active", true)
  if (addonErr) {
    allOk = false
    checks.push({ check: "pricing_addons_query", ok: false, error: `${addonErr.code}: ${addonErr.message}` })
  } else {
    checks.push({
      check: "pricing_addons_seeded",
      ok: (addonCount || 0) > 0,
      detail: `${addonCount || 0} active rows`,
    })
  }

  // 5. leads INSERT probe (real insert, then delete — no visible side effect)
  const probeSourceId = `health-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: probeLead, error: leadInsertErr } = await client
    .from("leads")
    .insert({
      tenant_id: tenant.id,
      source_id: probeSourceId,
      phone_number: "+19999999999", // non-routable reserved-range-like placeholder
      first_name: "HealthProbe",
      email: null,
      source: "website",
      status: "new",
      form_data: { health_probe: true, at: new Date().toISOString() },
      followup_stage: 5, // past final stage — never followed up
    })
    .select("id")
    .single()

  if (leadInsertErr || !probeLead) {
    allOk = false
    checks.push({
      check: "leads_insert",
      ok: false,
      error: `${leadInsertErr?.code || "unknown"}: ${leadInsertErr?.message || "no row returned"}`,
      detail: `hint=${leadInsertErr?.hint || ""} details=${leadInsertErr?.details || ""}`,
    })
  } else {
    checks.push({ check: "leads_insert", ok: true, detail: `probe_lead_id=${probeLead.id}` })
    // Clean up
    await client.from("leads").delete().eq("id", probeLead.id)
  }

  // 6. customers UPSERT probe
  const { data: probeCustomer, error: custErr } = await client
    .from("customers")
    .insert({
      tenant_id: tenant.id,
      phone_number: `+19999999${Math.floor(Math.random() * 900 + 100)}`,
      first_name: "HealthProbe",
      auto_response_disabled: true, // never text this
    })
    .select("id")
    .single()

  if (custErr || !probeCustomer) {
    allOk = false
    checks.push({
      check: "customers_insert",
      ok: false,
      error: `${custErr?.code || "unknown"}: ${custErr?.message || "no row returned"}`,
      detail: `hint=${custErr?.hint || ""} details=${custErr?.details || ""}`,
    })
  } else {
    checks.push({ check: "customers_insert", ok: true, detail: `probe_customer_id=${probeCustomer.id}` })
    await client.from("customers").delete().eq("id", probeCustomer.id)
  }

  // 7. TENANT_TIER_ADDITIONS registration (T7 prep)
  try {
    const { TENANT_TIER_ADDITIONS } = await import("@/lib/service-scope")
    const registered = Object.prototype.hasOwnProperty.call(TENANT_TIER_ADDITIONS, tenant.slug)
    checks.push({
      check: "tenant_tier_additions_registered",
      ok: registered,
      detail: registered
        ? `entries=${Object.keys(TENANT_TIER_ADDITIONS[tenant.slug]).join(',')}`
        : "Missing from TENANT_TIER_ADDITIONS — deep-tier included addons (baseboards, ceiling_fans, etc.) will be re-charged. See service-scope.ts.",
    })
    if (!registered) allOk = false
  } catch (err) {
    checks.push({
      check: "tenant_tier_additions_registered",
      ok: false,
      error: err instanceof Error ? err.message : "unknown",
    })
  }

  return NextResponse.json({ ok: allOk, slug, tenant_id: tenant.id, checks })
}
