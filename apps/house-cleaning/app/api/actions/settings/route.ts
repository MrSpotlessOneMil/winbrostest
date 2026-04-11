/**
 * Tenant Settings API
 *
 * GET  /api/actions/settings — returns current scheduling config + business info
 * POST /api/actions/settings — updates scheduling config (workflow_config) and/or business info (tenant columns)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// route-check:no-vercel-cron

const ALLOWED_NUMERIC_FIELDS = [
  "business_hours_start",
  "business_hours_end",
  "salesman_buffer_minutes",
  "technician_buffer_minutes",
] as const

const ALLOWED_JSON_FIELDS = [
  "window_tiers",
  "flat_services",
  "job_service_types",
  "winbros_addons",
] as const

// Business info fields stored as direct tenant columns
const ALLOWED_TENANT_FIELDS = [
  "business_name",
  "business_name_short",
  "service_area",
  "timezone",
  "sdr_persona",
  "owner_phone",
  "owner_email",
  "google_review_link",
] as const

const ALLOWED_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
] as const

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  const wc = ((authTenant.workflow_config ?? {}) as unknown as Record<string, unknown>)

  return NextResponse.json({
    success: true,
    settings: {
      business_hours_start: wc.business_hours_start ?? 480,
      business_hours_end: wc.business_hours_end ?? 1020,
      salesman_buffer_minutes: wc.salesman_buffer_minutes ?? 30,
      technician_buffer_minutes: wc.technician_buffer_minutes ?? 30,
    },
    business_info: {
      business_name: authTenant.business_name || "",
      business_name_short: authTenant.business_name_short || "",
      service_area: authTenant.service_area || "",
      timezone: authTenant.timezone || "America/Chicago",
      sdr_persona: authTenant.sdr_persona || "Mary",
      owner_phone: authTenant.owner_phone || "",
      owner_email: authTenant.owner_email || "",
      google_review_link: authTenant.google_review_link || "",
    },
    assignment_mode: wc.assignment_mode ?? (wc.use_broadcast_assignment ? 'broadcast' : 'distance'),
    service_description: authTenant.service_description || null,
    tenant_name: authTenant.name,
    currency: authTenant.currency || 'usd',
    cleaner_pay: {
      model: wc.cleaner_pay_model ?? (wc.cleaner_pay_percentage ? 'percentage' : 'hourly'),
      percentage: wc.cleaner_pay_percentage ?? null,
      hourly_standard: wc.cleaner_pay_hourly_standard ?? null,
      hourly_deep: wc.cleaner_pay_hourly_deep ?? null,
    },
    window_tiers: wc.window_tiers ?? null,
    flat_services: wc.flat_services ?? null,
    job_service_types: wc.job_service_types ?? null,
    winbros_addons: wc.winbros_addons ?? null,
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    )
  }

  // ── Workflow config updates (numeric + JSON fields) ──
  const workflowUpdates: Record<string, unknown> = {}
  for (const field of ALLOWED_NUMERIC_FIELDS) {
    if (field in body) {
      const val = Number(body[field])
      if (!Number.isFinite(val) || val < 0) {
        return NextResponse.json(
          { success: false, error: `Invalid value for ${field}` },
          { status: 400 }
        )
      }
      workflowUpdates[field] = val
    }
  }

  for (const field of ALLOWED_JSON_FIELDS) {
    if (field in body) {
      workflowUpdates[field] = body[field]
    }
  }

  // ── Assignment mode (workflow_config string field) ──
  if ('assignment_mode' in body) {
    const mode = body.assignment_mode
    if (mode !== 'broadcast' && mode !== 'ranked' && mode !== 'distance') {
      return NextResponse.json(
        { success: false, error: 'Invalid assignment_mode — must be broadcast, ranked, or distance' },
        { status: 400 }
      )
    }
    workflowUpdates.assignment_mode = mode
  }

  // ── Cleaner pay (workflow_config fields) ──
  if ('cleaner_pay' in body && typeof body.cleaner_pay === 'object' && body.cleaner_pay) {
    const cp = body.cleaner_pay as Record<string, unknown>
    if (cp.model === 'percentage' || cp.model === 'hourly') {
      workflowUpdates.cleaner_pay_model = cp.model
    }
    if (typeof cp.percentage === 'number') {
      workflowUpdates.cleaner_pay_percentage = Math.max(0, Math.min(100, cp.percentage))
    }
    if (typeof cp.hourly_standard === 'number') {
      workflowUpdates.cleaner_pay_hourly_standard = Math.max(0, cp.hourly_standard)
    }
    if (typeof cp.hourly_deep === 'number') {
      workflowUpdates.cleaner_pay_hourly_deep = Math.max(0, cp.hourly_deep)
    }
  }

  // ── Tenant column updates (business info) ──
  const tenantUpdates: Record<string, string | null> = {}
  const businessInfo = body.business_info as Record<string, unknown> | undefined
  if (businessInfo && typeof businessInfo === "object") {
    for (const field of ALLOWED_TENANT_FIELDS) {
      if (field in businessInfo) {
        const val = String(businessInfo[field] ?? "").trim()

        // Allow clearing optional fields by setting to null
        // Required fields (business_name, timezone, sdr_persona) must keep a value
        const REQUIRED_FIELDS = ["business_name", "timezone", "sdr_persona"]
        if (!val && REQUIRED_FIELDS.includes(field)) continue
        if (!val) {
          tenantUpdates[field] = null
          continue
        }

        // Field-specific validation
        if (field === "timezone" && !ALLOWED_TIMEZONES.includes(val as typeof ALLOWED_TIMEZONES[number])) {
          return NextResponse.json(
            { success: false, error: `Invalid timezone: ${val}` },
            { status: 400 }
          )
        }
        if (field === "business_name" && val.length > 100) {
          return NextResponse.json(
            { success: false, error: "Business name must be 100 characters or less" },
            { status: 400 }
          )
        }
        if (field === "business_name_short" && val.length > 30) {
          return NextResponse.json(
            { success: false, error: "Short name must be 30 characters or less" },
            { status: 400 }
          )
        }
        if (field === "owner_email" && val && !val.includes("@")) {
          return NextResponse.json(
            { success: false, error: "Invalid email format" },
            { status: 400 }
          )
        }

        tenantUpdates[field] = val
      }
    }
  }

  const hasWorkflow = Object.keys(workflowUpdates).length > 0
  const hasTenant = Object.keys(tenantUpdates).length > 0

  if (!hasWorkflow && !hasTenant) {
    return NextResponse.json(
      { success: false, error: "No valid settings provided" },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()

  // ── Save workflow_config updates ──
  if (hasWorkflow) {
    // Validate business hours range
    const wc = ((authTenant.workflow_config ?? {}) as unknown as Record<string, unknown>)
    const newStart = workflowUpdates.business_hours_start ?? wc.business_hours_start ?? 480
    const newEnd = workflowUpdates.business_hours_end ?? wc.business_hours_end ?? 1020
    if (newStart >= newEnd) {
      return NextResponse.json(
        { success: false, error: "Business hours start must be before end" },
        { status: 400 }
      )
    }

    const merged = { ...wc, ...workflowUpdates }
    const { error } = await client
      .from("tenants")
      .update({ workflow_config: merged })
      .eq("id", authTenant.id)

    if (error) {
      console.error("[settings] Workflow config update failed:", error.message)
      return NextResponse.json(
        { success: false, error: "Failed to save settings" },
        { status: 500 }
      )
    }
  }

  // ── Save tenant column updates ──
  if (hasTenant) {
    const { error } = await client
      .from("tenants")
      .update({ ...tenantUpdates, updated_at: new Date().toISOString() })
      .eq("id", authTenant.id)

    if (error) {
      console.error("[settings] Tenant info update failed:", error.message)
      return NextResponse.json(
        { success: false, error: "Failed to save business info" },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    success: true,
    settings: workflowUpdates,
    business_info: tenantUpdates,
  })
}
